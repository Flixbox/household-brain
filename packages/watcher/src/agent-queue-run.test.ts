/* oxlint-disable import/no-nodejs-modules -- subprocess fixtures use temporary local files and a fake gh, never GitHub */
import { afterEach, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'

const dirs: string[] = []
afterEach(async () => { await Promise.all(dirs.splice(0).map(async dir => rm(dir, { force: true, recursive: true }))) })

const T0 = '2026-11-01T09:00:00Z'
const T1 = '2026-11-01T10:00:00Z'

/** A PR the owner approved, with CI green and nothing open: agent-queue would queue it. */
const READY_PR = {
  autoMergeRequest: null,
  comments: { nodes: [], pageInfo: { hasPreviousPage: false } },
  commits: { nodes: [{ commit: { committedDate: T0, statusCheckRollup: { contexts: { nodes: [
    { checkSuite: { branch: { name: 'feature' }, createdAt: T0, workflowRun: { event: 'pull_request' } }, conclusion: 'SUCCESS', name: 'checks', status: 'COMPLETED' },
  ], pageInfo: { hasNextPage: false } } } } }] },
  headRefName: 'feature',
  headRefOid: 'c0ffee1',
  id: 'PR_one',
  isDraft: false,
  isInMergeQueue: false,
  isMergeQueueEnabled: false,
  labels: { nodes: [], pageInfo: { hasNextPage: false } },
  reviewThreads: { nodes: [], pageInfo: { hasNextPage: false } },
  reviews: { nodes: [{ author: { login: 'owner' }, state: 'APPROVED', submittedAt: T1 }], pageInfo: { hasPreviousPage: false } },
  state: 'OPEN',
  timelineItems: { nodes: [], pageInfo: { hasPreviousPage: false } },
}

/**
 * A stand-in for `agent-gh` since #360: it fails, as the real one does, when it can't tell the
 * repository (no `GH_REPO`, no `-R`, and the folder isn't a clone). Every call is logged with the
 * `GH_REPO` it got. `FAKE_VIEWER` is the login GitHub's `viewer` answers with.
 */
const FAKE = String.raw`
  import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
  const args = process.argv.slice(2)
  const repo = process.env.GH_REPO ?? ''
  appendFileSync(process.env.FIXTURE_HOME + '/calls', (repo || '-') + ' ' + args.join(' ').replaceAll('\n', ' ') + '\n')
  if (repo === '' && !args.includes('-R')) {
    console.error('agent-gh-token: set GH_REPO=owner/repo, or run it inside a clone')
    process.exit(1)
  }
  const joined = args.join(' ')
  if (process.env.FAKE_HANG && joined.includes(process.env.FAKE_HANG)) {
    // A child of the wrapper, as a real gh under a wrapper script: it outlives a killed parent and holds its stdout (#540).
    Bun.spawnSync(['sleep', '6'], { stderr: 'ignore', stdout: 'inherit' })
    process.exit(0)
  }
  const path = args.find(arg => arg.startsWith('repos/')) ?? ''
  if (args.includes('-i') && path !== '') {
    const script = JSON.parse(process.env.FAKE_REST ?? '{}')[path] ?? [{ body: { owner: { type: 'User' } } }]
    const seen = process.env.FIXTURE_HOME + '/seen-' + encodeURIComponent(path)
    const turn = existsSync(seen) ? Number(readFileSync(seen, 'utf8')) : 0
    writeFileSync(seen, String(turn + 1))
    const { body, headers = '', status = 200 } = script[Math.min(turn, script.length - 1)]
    console.log('HTTP/2.0 ' + status + ' X\n' + headers + '\n' + JSON.stringify(body))
    process.exit(status === 200 ? 0 : 1)
  }
  if (joined.includes('enablePullRequestAutoMerge')) {
    console.log('HTTP/2.0 200 OK\nContent-Type: application/json\n\n' + JSON.stringify({ data: { enablePullRequestAutoMerge: { clientMutationId: null } } }))
    process.exit(0)
  }
  for (const mutation of ['enqueuePullRequest', 'mergePullRequest']) {
    if (joined.includes(mutation)) {
      const refusal = process.env.FAKE_WRITE_ERROR ?? ''
      console.log('HTTP/2.0 200 OK\n\n' + JSON.stringify(refusal === '' ? { data: { [mutation]: { clientMutationId: null } } } : { data: null, errors: [{ message: refusal }] }))
      process.exit(0)
    }
  }
  if (joined.includes('viewer{login}')) {
    const refusedFile = process.env.FIXTURE_HOME + '/refused'
    if (process.env.FAKE_REFUSE === '1' && !existsSync(refusedFile)) {
      writeFileSync(refusedFile, '')
      console.log('HTTP/2.0 403 Forbidden\nRetry-After: 0\nX-RateLimit-Remaining: 17\n\n' + JSON.stringify({ message: 'You have exceeded a secondary rate limit' }))
      process.exit(1)
    }
    const body = JSON.stringify({ data: { repository: { pullRequest: JSON.parse(process.env.FAKE_PR) }, viewer: { login: process.env.FAKE_VIEWER } } })
    console.log(args.includes('-i') ? 'HTTP/2.0 200 OK\n\n' + body : body)
    process.exit(0)
  }
  console.error('unexpected call: ' + joined)
  process.exit(1)
`

/** Runs `agent-queue owner/repo 7` from a folder that isn't a clone, with GH_REPO unset, asking as `viewer`. */
const runFromNonClone = async (viewer: string, extra: Record<string, string> = {}) => {
  const home = await mkdtemp(`${tmpdir()}/agent-queue-`)
  dirs.push(home)
  const gh = `${home}/agent-gh`
  await Bun.write(`${home}/fake.ts`, FAKE)
  await Bun.write(gh, `#!/bin/sh\nexec "${process.execPath}" "${home}/fake.ts" "$@"\n`)
  await Bun.spawn(['chmod', '+x', gh]).exited
  const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => name !== 'GH_REPO' && name !== 'OWNER'))
  const started = Temporal.Now.instant().epochMilliseconds
  const child = Bun.spawn([process.execPath, `${import.meta.dir}/agent-queue.ts`, 'owner/repo', '7'], {
    cwd: home,
    env: { ...env, FAKE_PR: JSON.stringify(READY_PR), FAKE_VIEWER: viewer, FIXTURE_HOME: home, GH: gh, ...extra },
    stderr: 'pipe', stdout: 'pipe',
  })
  const [output, error, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
  const ms = Temporal.Now.instant().epochMilliseconds - started
  const calls = (await Bun.file(`${home}/calls`).text().catch(() => '')).split('\n').filter(line => line !== '')
  return { calls, code, error, ms, output }
}

test('agent-queue passes its repository to every agent-gh call, so it works outside a clone (#365)', async () => {
  const result = await runFromNonClone('agent-bot[bot]')
  expect({ code: result.code, error: result.error, output: result.output }).toEqual({ code: 0, error: '', output: 'Auto-merge (squash) is on for owner/repo#7 at c0ffee1.\n' })
  expect(result.calls.length).toBeGreaterThanOrEqual(3)
  expect(result.calls.filter(call => !call.startsWith('owner/repo '))).toEqual([])
})

test("agent-queue refuses to act when GitHub's viewer isn't a bot login (#365)", async () => {
  const result = await runFromNonClone('owner')
  expect(result.code).not.toBe(0)
  expect(result.error).toContain('asks as owner, not as a bot')
  expect(result.calls.filter(call => call.includes('enablePullRequestAutoMerge') || call.includes('mergePullRequest'))).toEqual([])
})

test('a read GitHub refuses for a rate limit logs the limit headers and is waited out once (#402)', async () => {
  const result = await runFromNonClone('agent-bot[bot]', { FAKE_REFUSE: '1' })
  expect(result.code).toBe(0)
  expect(result.error).toContain('retry-after: 0')
  expect(result.error).toContain('x-ratelimit-remaining: 17')
  expect(result.output).toContain('Auto-merge (squash) is on')
})

const REPO_PATH = 'repos/owner/repo'
const adminsPage = (page: number) => `${REPO_PATH}/collaborators?permission=admin&per_page=100&page=${page}`
const LIMITED = { body: { message: 'You have exceeded a secondary rate limit' }, headers: 'Retry-After: 0\nX-RateLimit-Remaining: 17\n', status: 403 }
const ORGANISATION = { body: { owner: { type: 'Organization' } } }
const NEXT_PAGE = 'Link: <https://api.github.com/next>; rel="next"\n'
const ADMIN = { login: 'admin-one', type: 'User' }

/** The fixture's answers to REST reads, by path, for a PR only `admin-one` approved: only their being the owner clears it. */
const restFor = (script: Record<string, unknown>) => ({
  FAKE_PR: JSON.stringify({ ...READY_PR, reviews: { nodes: [{ author: { login: ADMIN.login }, state: 'APPROVED', submittedAt: T1 }], pageInfo: { hasPreviousPage: false } } }),
  FAKE_REST: JSON.stringify(script),
})

const merges = (calls: readonly string[]) => calls.filter(call => call.includes('enablePullRequestAutoMerge') || call.includes('mergePullRequest'))

test('a rate limit on the repository lookup logs its headers and is waited out once (#428)', async () => {
  const result = await runFromNonClone('agent-bot[bot]', { FAKE_REST: JSON.stringify({ [REPO_PATH]: [LIMITED, { body: { owner: { type: 'User' } } }] }) })
  expect(result.error).toContain('retry-after: 0')
  expect(result.error).toContain('x-ratelimit-remaining: 17')
  expect(result.code).toBe(0)
})

test('the facts are read only after the owner lookup has waited out its rate limit (#428)', async () => {
  const result = await runFromNonClone('agent-bot[bot]', { FAKE_REST: JSON.stringify({ [REPO_PATH]: [LIMITED, { body: { owner: { type: 'User' } } }] }) })
  const lookups = result.calls.filter(call => call.includes(`api -i ${REPO_PATH}`))
  const lastLookup = result.calls.lastIndexOf(lookups.at(-1) ?? '')
  expect(lookups).toHaveLength(2)
  expect(result.calls.findIndex(call => call.includes('viewer{login}'))).toBeGreaterThan(lastLookup)
})

test('a rate limit on a later page of the admins is waited out, and every page is read (#428)', async () => {
  const script = { [REPO_PATH]: [ORGANISATION], [adminsPage(1)]: [{ body: [{ login: 'an-app', type: 'Bot' }], headers: NEXT_PAGE }], [adminsPage(2)]: [LIMITED, { body: [ADMIN] }] }
  const result = await runFromNonClone('agent-bot[bot]', restFor(script))
  expect(result.error).toContain('retry-after: 0')
  expect(result.output).toContain('Auto-merge (squash) is on')
  expect(result.code).toBe(0)
})

test('a page of the admins that stays refused does not make the first page the whole list (#428)', async () => {
  const script = { [REPO_PATH]: [ORGANISATION], [adminsPage(1)]: [{ body: [ADMIN], headers: NEXT_PAGE }], [adminsPage(2)]: [LIMITED] }
  const result = await runFromNonClone('agent-bot[bot]', restFor(script))
  expect(result.error).toContain("couldn't read")
  expect(result.code).toBe(1)
  expect(merges(result.calls)).toEqual([])
})

test("an answer that doesn't say what owns the repository counts as unread (#428)", async () => {
  const result = await runFromNonClone('agent-bot[bot]', restFor({ [REPO_PATH]: [{ body: 'not the repository' }] }))
  expect(result.error).toContain("couldn't read")
  expect(result.code).toBe(1)
  expect(merges(result.calls)).toEqual([])
})

const OUT_OF_TIME = 'ran out of time after 1 s'
const HUNG_CALL_TEST_MS = 15_000

test('a read that hangs fails with a message saying so, within its limit, and nothing is queued (#540)', async () => {
  const result = await runFromNonClone('agent-bot[bot]', { AGENT_GH_TIMEOUT_SECONDS: '1', FAKE_HANG: 'viewer{login}' })
  expect(result.error).toContain(OUT_OF_TIME)
  expect(result.code).not.toBe(0)
  expect(result.ms).toBeLessThan(5000)
  expect(merges(result.calls)).toEqual([])
}, HUNG_CALL_TEST_MS)

test('a queueing call that hangs fails, and is never reported as queued (#540)', async () => {
  const result = await runFromNonClone('agent-bot[bot]', { AGENT_GH_TIMEOUT_SECONDS: '1', FAKE_HANG: 'enablePullRequestAutoMerge' })
  expect(result.error).toContain(OUT_OF_TIME)
  expect(result.code).not.toBe(0)
  expect(result.output).toBe('')
  expect(result.ms).toBeLessThan(5000)
}, HUNG_CALL_TEST_MS)

const writes = (calls: readonly string[]) => calls.filter(call => /enqueuePullRequest|enablePullRequestAutoMerge|mergePullRequest|disablePullRequestAutoMerge/u.test(call))
const ALREADY = 'owner/repo#7 is already set to auto-merge.'
/** Approved, green and CLEAN, its auto-merge request and everything else hours old, and not in the merge queue (#544). */
const STUCK = { ...READY_PR, autoMergeRequest: { enabledAt: T0 }, isMergeQueueEnabled: true, mergeStateStatus: 'CLEAN' }
const stuckRun = async (change: Record<string, unknown> = {}, extra: Record<string, string> = {}) => runFromNonClone('agent-bot[bot]', { FAKE_PR: JSON.stringify({ ...STUCK, ...change }), ...extra })
const secondsAgo = () => Temporal.Now.instant().toString()
const approvedAt = (when: string) => ({ reviews: { nodes: [{ author: { login: 'owner' }, state: 'APPROVED', submittedAt: when }], pageInfo: { hasPreviousPage: false } } })

test('a stuck auto-merge request gets the PR into the merge queue, pinned to the head it checked (#544)', async () => {
  const result = await stuckRun()
  expect({ code: result.code, error: result.error, output: result.output }).toEqual({ code: 0, error: '', output: 'Added to the merge queue (its auto-merge request was stuck): owner/repo#7 at c0ffee1.\n' })
  const [write, ...others] = writes(result.calls)
  expect(others).toEqual([])
  expect(write).toContain('enqueuePullRequest')
  expect(write).toContain('expectedHeadOid:$head')
  expect(write).toContain('head=c0ffee1')
})

test('a stuck request GitHub refuses to queue fails, saying so, not as if it had succeeded (#544)', async () => {
  const result = await stuckRun({}, { FAKE_WRITE_ERROR: 'Pull request is not mergeable' })
  expect(result.code).not.toBe(0)
  expect(result.output).toBe('')
  expect(result.error).toContain('still not in the merge queue')
  expect(result.error).toContain('Pull request is not mergeable')
})

test('a stuck request on a branch without a merge queue is merged, as a clean PR is (#544)', async () => {
  const result = await stuckRun({ isMergeQueueEnabled: false })
  expect(result.code).toBe(0)
  expect(result.output).toBe('Merged (squash, its auto-merge request was stuck): owner/repo#7 at c0ffee1.\n')
  const [write, ...others] = writes(result.calls)
  expect(others).toEqual([])
  expect(write).toContain('mergePullRequest')
  expect(write).toContain('expectedHeadOid:$head')
})

const PENDING_CHECKS = { commits: { nodes: [{ commit: { committedDate: T0, statusCheckRollup: { contexts: { nodes: [
  { checkSuite: { branch: { name: 'feature' }, createdAt: T0, workflowRun: { event: 'pull_request' } }, conclusion: null, name: 'checks', status: 'IN_PROGRESS' },
], pageInfo: { hasNextPage: false } } } } }] } }

test.each([
  ['still waiting for CI', PENDING_CHECKS],
  ['still waiting for the approval', { reviews: { nodes: [], pageInfo: { hasPreviousPage: false } } }],
  ['not CLEAN yet', { mergeStateStatus: 'BLOCKED' }],
  ['a request only seconds old', { autoMergeRequest: { enabledAt: secondsAgo() } }],
  ['an old request whose approval came seconds ago', approvedAt(secondsAgo())],
] as const)('auto-merge is left as it is, and nothing is written: %s (#544)', async (_name, change) => {
  const result = await stuckRun(change)
  expect(result.code).toBe(0)
  expect(result.output).toContain(ALREADY)
  expect(writes(result.calls)).toEqual([])
})

test('a PR in the merge queue stays as it is (#544)', async () => {
  const result = await stuckRun({ isInMergeQueue: true })
  expect(result.output).toBe('owner/repo#7 is already in the merge queue.\n')
  expect(writes(result.calls)).toEqual([])
})
