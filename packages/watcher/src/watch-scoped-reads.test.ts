/* oxlint-disable import/no-nodejs-modules -- a temporary folder for the watcher's state and its fake gh */
import { afterEach, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'

const dirs: string[] = []
afterEach(async () => { await Promise.all(dirs.splice(0).map(async dir => rm(dir, { force: true, recursive: true }))) })

/**
 * A `gh` for a repository with three open PRs: 7 (subscribed, merged), 8 (unrelated) and 9 (closes the
 * subscribed issue 4). PR 6 closes issue 4 too and merged a minute ago, between two looks; PR 3 closed
 * it long ago, before it was reopened. It keeps every call in `calls`. Issue 4 gets the owner's answer
 * from its COMMENT_FROM-th comment read on (the second by default), and is closed from its third, so
 * the subscription completes. Issue 5 is gone: any query that asks about it fails.
 */
const FAKE_GH = String.raw`
  import { appendFileSync, readFileSync, writeFileSync } from 'node:fs'
  const text = process.argv.slice(2).join(' ').replaceAll('\n', ' ')
  const home = process.env.FIXTURE_HOME
  appendFileSync(home + '/calls', text + '\n')
  const answer = value => { console.log(JSON.stringify(value)); process.exit(0) }
  const reads = () => { try { return Number(readFileSync(home + '/comment-reads', 'utf8')) } catch { return 0 } }
  if (text.includes('mergeQueue{id}') || /issue\(number: ?5\)/.test(text)) { process.exit(text.includes('mergeQueue{id}') ? 0 : 1) }
  if (text.startsWith('pr list') && text.includes('--state open')) { answer([{ number: 7 }, { number: 8 }, { number: 9 }]) }
  if (text.startsWith('pr list') || text.startsWith('run list')) { answer([]) }
  if (text.startsWith('api repos/')) { answer({ ahead_by: 0, commit: { message: 'main' }, commits: [], sha: 'main1' }) }
  const state = pr => ({
    author: { login: 'agent' },
    closingIssuesReferences: { nodes: pr === 9 ? [{ number: 4 }] : [] },
    headRefOid: 'head' + pr,
    mergeCommit: pr === 7 || pr === 6 ? { oid: 'merge' + pr } : null,
    mergeable: 'MERGEABLE',
    state: pr === 7 || pr === 6 ? 'MERGED' : 'OPEN',
    title: 'PR ' + pr,
  })
  const prs = [...text.matchAll(/pr(\d+): pullRequest\(number: (\d+)\)/g)].map(match => Number(match[1]))
  if (prs.length > 0) {
    const activity = text.includes('reviews(last:100){nodes{databaseId')
    answer({ data: { repository: Object.fromEntries(prs.map(pr => ['pr' + pr, activity ? { comments: { nodes: [] }, reviews: { nodes: [] } } : state(pr)])) } })
  }
  const issues = [...text.matchAll(/issue(\d+): ?issue\(number: ?(\d+)\)/g)].map(match => Number(match[1]))
  if (issues.length > 0) {
    if (text.includes('comments(')) { writeFileSync(home + '/comment-reads', String(reads() + 1)) }
    const comments = reads() >= Number(process.env.COMMENT_FROM ?? 2) ? [{ author: { login: 'owner' }, body: 'OWNER_ISSUE_ANSWER', createdAt: Temporal.Now.instant().toString(), databaseId: 41, url: 'https://comments.test/41' }] : []
    const issue = { closedByPullRequestsReferences: { nodes: [
      { mergedAt: '2026-01-01T00:00:00Z', number: 3, state: 'MERGED' },
      { mergedAt: Temporal.Now.instant().subtract({ minutes: 1 }).toString(), number: 6, state: 'MERGED' },
      { mergedAt: null, number: 9, state: 'OPEN' },
    ] }, comments: { nodes: comments }, number: 4, state: reads() >= 3 ? 'CLOSED' : 'OPEN' }
    answer({ data: { repository: Object.fromEntries(issues.map(number => ['issue' + number, issue])) } })
  }
  answer({ data: { repository: { issues: { nodes: [], pageInfo: { hasNextPage: false } } } } })
`

const WATCHER = `
  process.argv.push('--follow')
  const sleep = Bun.sleep
  Bun.sleep = ms => sleep(Math.min(ms, 20))
  await import('${import.meta.dir}/watch-project')
`

interface Options {
  /** The fake's COMMENT_FROM. */
  commentFrom?: string
  /** Kill the watcher after this long: a subscription to a gone issue never completes. */
  timeout?: number
  /** Start as a watcher that ran before #357: its `issue-events` file is there. */
  upgraded?: boolean
}

/** Runs a watcher subscribed to `selection` against the fake `gh` until its subscription completes. */
const runScoped = async (selection: string, { commentFrom = '2', timeout = 10_000, upgraded = false }: Options = {}) => {
  const home = await mkdtemp(`${tmpdir()}/watch-scoped-`)
  dirs.push(home)
  await Bun.write(`${home}/fake.ts`, FAKE_GH)
  await Bun.write(`${home}/gh`, `#!/bin/sh\nexec "${process.execPath}" "${home}/fake.ts" "$@"\n`)
  await Bun.spawn(['chmod', '+x', `${home}/gh`]).exited
  await (upgraded ? Bun.write(`${home}/state/issue-events`, 'issue #1\n') : Promise.resolve())
  const env = { ...process.env, ACTIVITY_GH: `${home}/gh`, AGENT_USAGE_PROVIDER: 'claude', CLAUDE_CODE_SESSION_ID: '', CLAUDE_CONFIG_DIR: home, CODEX_THREAD_ID: '', CODEX_WATCH_THREAD: '', COMMENT_FROM: commentFrom, FIXTURE_HOME: home, GH: `${home}/gh`, GH_SHARE_SECONDS: '0', OWNER: 'owner', REPO: 'owner/repo', SELF: 'agent', STATE_DIR: `${home}/state`, WATCHER_SUBSCRIPTIONS: selection, XDG_STATE_HOME: home }
  const watcher = Bun.spawn([process.execPath, '-e', WATCHER], { env, stderr: 'pipe', stdout: 'pipe', timeout })
  const [output, code] = await Promise.all([new Response(watcher.stdout).text(), watcher.exited])
  const calls = (await Bun.file(`${home}/calls`).text()).split('\n').filter(Boolean)
  return { calls, code, output }
}

const prsAskedAbout = (calls: readonly string[]) =>
  [...new Set(calls.flatMap(call => [...call.matchAll(/pullRequest\(number: ?(?<pr>\d+)\)/gu)].map(match => Number(match.groups?.pr))))].toSorted((first, second) => first - second)

test('a scoped watcher reads only its subjects: no open-PR, open-issue or repository-wide lists (#357)', async () => {
  const { calls, code, output } = await runScoped('pr:7,issue:4')
  // PR 7 is subscribed, PRs 6 and 9 close issue 4; PR 8 is none of its business, and PR 3's merge is old.
  expect(prsAskedAbout(calls)).toEqual([6, 7, 9])
  expect(calls.filter(call => call.startsWith('pr list'))).toEqual([])
  expect(calls.filter(call => call.includes('issues(states:OPEN') || call.includes('created: issues('))).toEqual([])
  // What it reads instead still brings the owner's answer on the issue, and the issue's closing.
  expect(output).toContain('OWNER_ISSUE_ANSWER')
  expect(output.indexOf('OWNER_ISSUE_ANSWER')).toBeLessThan(output.indexOf('ISSUE_CLOSED #4: subscription completed'))
  expect(code).toBe(3)
}, 30_000)

test('a gone subscribed issue holds back neither the other issues nor the PRs (#357)', async () => {
  const { calls, code, output } = await runScoped('pr:7,issue:4,issue:5', { timeout: 8000 })
  expect(prsAskedAbout(calls)).toEqual([6, 7, 9])
  expect(output).toContain('PR #7: MERGED')
  expect(output).toContain('OWNER_ISSUE_ANSWER')
  expect(output).toContain('ISSUE_CLOSED #4: subscription completed')
  expect(output).not.toContain('WATCHER_ERROR')
  // Issue 5 never closes, so the subscription never completes: the watcher was stopped.
  expect(code).not.toBe(3)
}, 30_000)

test('after the upgrade, an owner comment newer than the old issue-events file is still news (#357)', async () => {
  const { code, output } = await runScoped('pr:7,issue:4', { commentFrom: '1', upgraded: true })
  expect(output).toContain('OWNER_ISSUE_ANSWER')
  expect(code).toBe(3)
}, 30_000)
