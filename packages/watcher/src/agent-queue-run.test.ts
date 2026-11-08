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
  if (joined.startsWith('api repos/')) { console.log('User'); process.exit(0) }
  if (joined.includes('enablePullRequestAutoMerge')) {
    console.log('HTTP/2.0 200 OK\nContent-Type: application/json\n\n' + JSON.stringify({ data: { enablePullRequestAutoMerge: { clientMutationId: null } } }))
    process.exit(0)
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
  const child = Bun.spawn([process.execPath, `${import.meta.dir}/agent-queue.ts`, 'owner/repo', '7'], {
    cwd: home,
    env: { ...env, FAKE_PR: JSON.stringify(READY_PR), FAKE_VIEWER: viewer, FIXTURE_HOME: home, GH: gh, ...extra },
    stderr: 'pipe', stdout: 'pipe',
  })
  const [output, error, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
  const calls = (await Bun.file(`${home}/calls`).text().catch(() => '')).split('\n').filter(line => line !== '')
  return { calls, code, error, output }
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
