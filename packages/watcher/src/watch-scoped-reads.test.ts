/* oxlint-disable import/no-nodejs-modules -- a temporary folder for the watcher's state and its fake gh */
import { afterEach, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'

const dirs: string[] = []
afterEach(async () => { await Promise.all(dirs.splice(0).map(async dir => rm(dir, { force: true, recursive: true }))) })

/**
 * A `gh` for a repository with three open PRs: 7 (subscribed, merged), 8 (unrelated) and 9 (closes the
 * subscribed issue 4). It keeps every call in `calls`. Issue 4 gets the owner's answer from its second
 * comment read on, and is closed from its third, so the subscription completes.
 */
const FAKE_GH = String.raw`
  import { appendFileSync, readFileSync, writeFileSync } from 'node:fs'
  const text = process.argv.slice(2).join(' ').replaceAll('\n', ' ')
  const home = process.env.FIXTURE_HOME
  appendFileSync(home + '/calls', text + '\n')
  const answer = value => { console.log(JSON.stringify(value)); process.exit(0) }
  const reads = () => { try { return Number(readFileSync(home + '/comment-reads', 'utf8')) } catch { return 0 } }
  if (text.includes('mergeQueue{id}')) { process.exit(0) }
  if (text.startsWith('pr list') && text.includes('--state open')) { answer([{ number: 7 }, { number: 8 }, { number: 9 }]) }
  if (text.startsWith('pr list') || text.startsWith('run list')) { answer([]) }
  if (text.startsWith('api repos/')) { answer({ ahead_by: 0, commit: { message: 'main' }, commits: [], sha: 'main1' }) }
  const state = pr => ({
    author: { login: 'agent' },
    closingIssuesReferences: { nodes: pr === 9 ? [{ number: 4 }] : [] },
    headRefOid: 'head' + pr,
    mergeCommit: pr === 7 ? { oid: 'merge7' } : null,
    mergeable: 'MERGEABLE',
    state: pr === 7 ? 'MERGED' : 'OPEN',
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
    const comments = reads() >= 2 ? [{ author: { login: 'owner' }, body: 'OWNER_ISSUE_ANSWER', createdAt: Temporal.Now.instant().toString(), databaseId: 41, url: 'https://comments.test/41' }] : []
    const issue = { closedByPullRequestsReferences: { nodes: [{ number: 9 }] }, comments: { nodes: comments }, number: 4, state: reads() >= 3 ? 'CLOSED' : 'OPEN' }
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

/** Runs a watcher subscribed to `selection` against the fake `gh` until its subscription completes. */
const runScoped = async (selection: string) => {
  const home = await mkdtemp(`${tmpdir()}/watch-scoped-`)
  dirs.push(home)
  await Bun.write(`${home}/fake.ts`, FAKE_GH)
  await Bun.write(`${home}/gh`, `#!/bin/sh\nexec "${process.execPath}" "${home}/fake.ts" "$@"\n`)
  await Bun.spawn(['chmod', '+x', `${home}/gh`]).exited
  const env = { ...process.env, ACTIVITY_GH: `${home}/gh`, AGENT_USAGE_PROVIDER: 'claude', CLAUDE_CODE_SESSION_ID: '', CLAUDE_CONFIG_DIR: home, CODEX_THREAD_ID: '', CODEX_WATCH_THREAD: '', FIXTURE_HOME: home, GH: `${home}/gh`, GH_SHARE_SECONDS: '0', OWNER: 'owner', REPO: 'owner/repo', SELF: 'agent', STATE_DIR: `${home}/state`, WATCHER_SUBSCRIPTIONS: selection, XDG_STATE_HOME: home }
  const watcher = Bun.spawn([process.execPath, '-e', WATCHER], { env, stderr: 'pipe', stdout: 'pipe', timeout: 10_000 })
  const [output, code] = await Promise.all([new Response(watcher.stdout).text(), watcher.exited])
  const calls = (await Bun.file(`${home}/calls`).text()).split('\n').filter(Boolean)
  return { calls, code, output }
}

const prsAskedAbout = (calls: readonly string[]) =>
  [...new Set(calls.flatMap(call => [...call.matchAll(/pullRequest\(number: ?(?<pr>\d+)\)/gu)].map(match => Number(match.groups?.pr))))].toSorted((first, second) => first - second)

test('a scoped watcher reads only its subjects: no open-PR, open-issue or repository-wide lists (#357)', async () => {
  const { calls, code, output } = await runScoped('pr:7,issue:4')
  // PR 7 is subscribed and PR 9 closes issue 4; PR 8 is none of its business.
  expect(prsAskedAbout(calls)).toEqual([7, 9])
  expect(calls.filter(call => call.startsWith('pr list'))).toEqual([])
  expect(calls.filter(call => call.includes('issues(states:OPEN') || call.includes('created: issues('))).toEqual([])
  // What it reads instead still brings the owner's answer on the issue, and the issue's closing.
  expect(output).toContain('OWNER_ISSUE_ANSWER')
  expect(output.indexOf('OWNER_ISSUE_ANSWER')).toBeLessThan(output.indexOf('ISSUE_CLOSED #4: subscription completed'))
  expect(code).toBe(3)
}, 30_000)
