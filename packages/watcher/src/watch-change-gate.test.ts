/* oxlint-disable import/no-nodejs-modules -- a temporary folder for the watcher's state and its fake gh */
import { afterEach, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { duePrs } from './watch-change-due'

const dirs: string[] = []
afterEach(async () => { await Promise.all(dirs.splice(0).map(async dir => rm(dir, { force: true, recursive: true }))) })

/**
 * A `gh` for one open PR, 7, keeping every call in `calls`, each after the look it came in: how many
 * times the PR's CI run was asked about before it. From look 2 on the owner has a pending review, from
 * look CI_DONE_AT on the run has passed, and nothing the change gate asks about moves for either. From
 * look 5 on the PR is merged, and only then does the gate show a change.
 */
const FAKE_GH = String.raw`
  import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
  const text = process.argv.slice(2).join(' ').replaceAll('\n', ' ')
  const home = process.env.FIXTURE_HOME
  const number = name => { try { return Number(readFileSync(home + '/' + name, 'utf8')) } catch { return 0 } }
  const look = number('looks')
  appendFileSync(home + '/calls', look + ' ' + text + '\n')
  const answer = value => { console.log(JSON.stringify(value)); process.exit(0) }
  const merged = look >= 5
  const owner = { login: 'owner' }
  const agent = { login: 'agent' }
  if (text.includes('mergeQueue{id}')) { process.exit(0) }
  if (text.includes('resolveReviewThread')) {
    writeFileSync(home + '/resolved', 'yes')
    answer({ data: { resolveReviewThread: { thread: { isResolved: true } } } })
  }
  const rest = value => { process.stdout.write('HTTP/2.0 200 OK\r\n\r\n' + JSON.stringify(value)); process.exit(0) }
  if (text.includes('runs?head_sha=')) {
    writeFileSync(home + '/looks', String(look + 1))
    const done = look >= Number(process.env.CI_DONE_AT)
    rest({ workflow_runs: [{ conclusion: done ? 'success' : null, id: 70, run_attempt: 1, run_started_at: Temporal.Now.instant().toString(), status: done ? 'completed' : 'in_progress' }] })
  }
  if (text.includes('pulls?state=open')) { rest([{ number: 7 }]) }
  if (text.includes('pulls?state=closed')) { rest([]) }
  if (text.startsWith('api -i')) { rest({ commit: { message: 'main' }, sha: 'main1' }) }
  if (text.startsWith('run view')) { answer({ jobs: [] }) }
  if (text.startsWith('run list')) { answer([]) }
  if (text.startsWith('pr list') && text.includes('--state open')) {
    answer([{ autoMergeRequest: null, headRefOid: 'head7', isDraft: false, labels: [], mergeStateStatus: 'BLOCKED', number: 7, statusCheckRollup: [], title: 'PR 7' }])
  }
  if (text.startsWith('pr list')) { answer([]) }
  if (text.startsWith('api repos/')) { answer({ ahead_by: 0, commit: { message: 'main' }, commits: [], sha: 'main1' }) }
  if (text.includes('pullRequests(first:100')) {
    answer({ data: { repository: { pullRequests: { nodes: [{
      autoMergeRequest: null, commits: { nodes: [{ commit: { statusCheckRollup: { state: 'SUCCESS' } } }] }, headRefOid: 'head7', isInMergeQueue: false,
      mergeStateStatus: 'BLOCKED', mergeable: 'MERGEABLE', number: 7, state: merged ? 'MERGED' : 'OPEN', updatedAt: merged ? '2026-01-02T00:00:00Z' : '2026-01-01T00:00:00Z',
    }] } } } })
  }
  const pending = look >= 2 ? [{ author: owner, body: 'OWNER_PENDING', comments: { nodes: [] }, createdAt: '2026-01-01T00:00:00Z', databaseId: 91, state: 'PENDING', submittedAt: null, url: 'https://comments.test/91' }] : []
  const state = {
    author: agent, closingIssuesReferences: { nodes: [] }, comments: { nodes: [] }, headRefOid: 'head7', labels: { nodes: [] }, mergeCommit: merged ? { oid: 'merge7' } : null,
    mergeStateStatus: 'BLOCKED', mergeable: 'MERGEABLE', reviewThreads: { nodes: [{ comments: { nodes: [{ author: owner, body: 'Resolved: done', url: 'https://comments.test/1' }] }, id: 'T1', isResolved: existsSync(home + '/resolved') }] },
    reviews: { nodes: [] }, state: merged ? 'MERGED' : 'OPEN', title: 'PR 7',
  }
  if (text.includes('pr7: pullRequest(number: 7)')) {
    const activity = text.includes('submittedAt') && !text.includes('reviewThreads')
    answer({ data: { repository: { pr7: activity ? { comments: { nodes: [] }, reviews: { nodes: pending } } : state } } })
  }
  answer({ data: { repository: { issues: { nodes: [], pageInfo: { hasNextPage: false } } } } })
`

const following = `
  process.argv.push('--follow')
  const sleep = Bun.sleep
  Bun.sleep = ms => sleep(Math.min(ms, 20))
  await import('${import.meta.dir}/watch-project')
`
const oneLook = `await import('${import.meta.dir}/watch-project')`

/** Runs the watcher against the fake `gh` until it exits by itself. */
const run = async (script: string, settings: Record<string, string>, timeout = 15_000) => {
  const home = await mkdtemp(`${tmpdir()}/watch-gate-`)
  dirs.push(home)
  await Bun.write(`${home}/fake.ts`, FAKE_GH)
  await Bun.write(`${home}/gh`, `#!/bin/sh\nexec "${process.execPath}" "${home}/fake.ts" "$@"\n`)
  await Bun.spawn(['chmod', '+x', `${home}/gh`]).exited
  const env = { ...process.env, ACTIVITY_GH: `${home}/gh`, AGENT_USAGE_PROVIDER: 'claude', CLAUDE_CODE_SESSION_ID: '', CLAUDE_CONFIG_DIR: home, CODEX_THREAD_ID: '', CODEX_WATCH_THREAD: '', FIXTURE_HOME: home, GH: `${home}/gh`, GH_SHARE_SECONDS: '0', OWNER: 'owner', REPO: 'owner/repo', SELF: 'agent', STATE_DIR: `${home}/state`, WATCHER_SUBSCRIPTIONS: '', XDG_STATE_HOME: home, ...settings }
  const watcher = Bun.spawn([process.execPath, '-e', script], { env, stderr: 'pipe', stdout: 'pipe', timeout })
  const [output, code] = await Promise.all([new Response(watcher.stdout).text(), watcher.exited])
  const calls = (await Bun.file(`${home}/calls`).text()).split('\n').filter(Boolean)
  return { calls, code, output }
}

test('a PR that did not change is not read in full, yet its pending review and CI result still arrive (#404)', async () => {
  const { calls, code, output } = await run(following, { CI_DONE_AT: '3', WATCHER_SUBSCRIPTIONS: 'pr:7' })
  const quiet = calls.filter(call => { const look = Number(call.split(' ')[0]); return look >= 2 && look < 5 })
  expect(quiet.length).toBeGreaterThan(0)
  expect(quiet.filter(call => call.includes('reviewThreads(') || call.includes('reviews(last:'))).toEqual([])
  expect(output).toContain('OWNER_PENDING')
  expect(output).toContain('CI_PASSED')
  expect(code).toBe(3)
}, 30_000)

test('a look lists the open PRs once, for its events and its reminders together (#404)', async () => {
  const { calls, code, output } = await run(oneLook, { CI_DONE_AT: '0' })
  expect(output).toContain('CI_PASSED')
  expect(calls.filter(call => call.includes('pr list') && call.includes('statusCheckRollup'))).toHaveLength(1)
  expect(code).toBe(0)
}, 30_000)

test('a PR is due when never read, not in the gate, changed, or read too long ago (#404)', () => {
  const known = new Map([[1, { at: 0, print: 'a' }], [2, { at: 0, print: 'a' }], [3, { at: 0, print: 'a' }], [5, { at: 0, print: 'a' }]])
  const prints = new Map([[1, 'a'], [2, 'b'], [4, 'a'], [5, 'a']])
  expect(duePrs({ known, now: 100, prints, prs: [1, 2, 3, 4], refreshMs: 1000 })).toEqual([2, 3, 4])
  expect(duePrs({ known, now: 1000, prints, prs: [1, 5], refreshMs: 1000 })).toEqual([1, 5])
})

test('a thread the watcher resolved is not resolved again from what it remembers (#404)', async () => {
  // The all-events watcher is the one that writes; it never exits by itself, so it is stopped.
  const { calls } = await run(following, { CI_DONE_AT: '0' }, 4000)
  expect(calls.filter(call => call.includes('resolveReviewThread'))).toHaveLength(1)
}, 30_000)
