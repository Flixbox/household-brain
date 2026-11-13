/* oxlint-disable import/no-nodejs-modules -- subprocess fixtures use temporary local files and a fake gh, never GitHub */
/** What the tests that run `agent-queue` (agent-queue-run.test.ts, agent-queue-5xx.test.ts) share: a fake `agent-gh` and a run of the command against it. */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'

const dirs: string[] = []
/** Removes the folders the runs made; for `afterEach`. */
export const removeRuns = async (): Promise<void> => { await Promise.all(dirs.splice(0).map(async dir => rm(dir, { force: true, recursive: true }))) }

export const T0 = '2026-11-01T09:00:00Z'
export const T1 = '2026-11-01T10:00:00Z'

/** A PR the owner approved, with CI green and nothing open: agent-queue would queue it. */
export const READY_PR = {
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
  // Now, as an HTTP Date header has it: "Fri, 13 Nov 2026 21:07:46 GMT".
  const httpDate = () => {
    const now = Temporal.Now.zonedDateTimeISO('UTC')
    const two = value => String(value).padStart(2, '0')
    const day = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][now.dayOfWeek - 1]
    const month = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][now.month - 1]
    return day + ', ' + two(now.day) + ' ' + month + ' ' + now.year + ' ' + two(now.hour) + ':' + two(now.minute) + ':' + two(now.second) + ' GMT'
  }
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
    const seen = process.env.FIXTURE_HOME + '/seen-auto'
    const turn = existsSync(seen) ? Number(readFileSync(seen, 'utf8')) : 0
    writeFileSync(seen, String(turn + 1))
    if (turn === 0 && process.env.FAKE_AUTO_STATUS) {
      console.log('HTTP/2.0 ' + process.env.FAKE_AUTO_STATUS + ' X\nDate: ' + httpDate() + '\n\n' + JSON.stringify({ message: 'Server Error' }))
      process.exit(1)
    }
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
  if (joined.includes('history(first:')) {
    // As GitHub's history(since:), when asked with one: only the commits committed since then (#579).
    const since = args.find(arg => arg.startsWith('since='))?.slice('since='.length) ?? ''
    const pullRequest = JSON.parse(process.env.FAKE_LANDED ?? 'null')
    const history = pullRequest?.baseRef?.target?.history
    if (since !== '' && history) {
      history.nodes = history.nodes.filter(commit => Temporal.Instant.compare(Temporal.Instant.from(commit.committedDate), Temporal.Instant.from(since)) >= 0)
    }
    console.log('HTTP/2.0 200 OK\n\n' + JSON.stringify({ data: { repository: { pullRequest } } }))
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

/** A new folder holding the fake `agent-gh`, removed after the test by `removeRuns`. */
const fakeHome = async (): Promise<{ gh: string, home: string }> => {
  const home = await mkdtemp(`${tmpdir()}/agent-queue-`)
  dirs.push(home)
  const gh = `${home}/agent-gh`
  await Bun.write(`${home}/fake.ts`, FAKE)
  await Bun.write(gh, `#!/bin/sh\nexec "${process.execPath}" "${home}/fake.ts" "$@"\n`)
  await Bun.spawn(['chmod', '+x', gh]).exited
  return { gh, home }
}

/** Runs `agent-queue owner/repo 7` from a folder that isn't a clone, with GH_REPO unset, asking as `viewer`. */
export const runFromNonClone = async (viewer: string, extra: Record<string, string> = {}) => {
  const { gh, home } = await fakeHome()
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
