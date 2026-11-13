import { afterEach, expect, test } from 'bun:test'
import { removeRuns, runFromNonClone } from './agent-queue-fixture'

afterEach(removeRuns)

const HEAD_TREE = 'tree-of-head'
/** A commit date long before the run, and one after its write: only the latter can be the write's squash (#579). */
const BEFORE = '2026-11-01T09:00:00Z'
const AFTER = Temporal.Now.instant().add({ hours: 1 }).toString()
interface Commit { date?: string, headline: string, oid: string, tree: string }
/** What the PR and the top of its base branch look like after a write GitHub answered with a 5xx (#577): `commits`, newest first. */
const afterServerError = (state: string, commits: readonly Commit[], { autoMerge = false, mergeCommit = null, queued = false }: { autoMerge?: boolean, mergeCommit?: string | null, queued?: boolean } = {}) => JSON.stringify({
  autoMergeRequest: autoMerge ? { enabledAt: BEFORE } : null,
  baseRef: { target: { history: { nodes: commits.map(({ date = AFTER, headline, oid, tree }) => ({ committedDate: date, messageHeadline: headline, oid, tree: { oid: tree } })) } } },
  commits: { nodes: [{ commit: { tree: { oid: HEAD_TREE } } }] },
  isInMergeQueue: queued,
  mergeCommit: mergeCommit === null ? null : { oid: mergeCommit },
  state,
})
const OTHER = { headline: 'Something else (#6)', oid: 'aaaaaaa1', tree: 'tree-other' }
const autoMerges = (calls: readonly string[]) => calls.filter(call => call.includes('enablePullRequestAutoMerge'))
/** No wait before the re-read, but in the test that checks it. */
const NO_WAIT = { AGENT_QUEUE_5XX_WAIT_SECONDS: '0', FAKE_AUTO_STATUS: '502' }

test.each([
  ['the same tree as the head', { headline: 'A squash with a new title', oid: 'fb7bb5f0', tree: HEAD_TREE }],
  ['a commit naming the PR', { headline: 'The change (#5) (#7)', oid: 'fb7bb5f0', tree: 'tree-after-main-moved' }],
] as const)('a 5xx whose merge landed on main anyway, as %s, is reported as landed with its own exit code and not tried again (#577, #579)', async (_name, landed) => {
  const result = await runFromNonClone('agent-bot[bot]', { ...NO_WAIT, FAKE_LANDED: afterServerError('OPEN', [OTHER, landed]) })
  expect(result.code).toBe(3)
  expect(result.output).toBe('')
  expect(result.error).toContain("owner/repo#7 landed on main as fb7bb5f0, but GitHub didn't mark the PR merged")
  expect(autoMerges(result.calls)).toHaveLength(1)
})

test.each([
  ['the same tree as the head (a PR reverting main to it)', { date: BEFORE, headline: 'An older change', oid: 'ccccccc3', tree: HEAD_TREE }],
  ['a commit naming the PR', { date: BEFORE, headline: 'Cherry-picked from (#7)', oid: 'ccccccc3', tree: 'tree-other' }],
] as const)('a 5xx is tried once more when only a commit older than the write has %s (#579)', async (_name, older) => {
  const result = await runFromNonClone('agent-bot[bot]', { ...NO_WAIT, FAKE_LANDED: afterServerError('OPEN', [OTHER, older]) })
  expect({ code: result.code, output: result.output }).toEqual({ code: 0, output: 'Auto-merge (squash) is on for owner/repo#7 at c0ffee1.\n' })
  expect(autoMerges(result.calls)).toHaveLength(2)
})

test('a 5xx whose merge did not land is tried once more (#577)', async () => {
  const result = await runFromNonClone('agent-bot[bot]', { ...NO_WAIT, FAKE_LANDED: afterServerError('OPEN', [OTHER, { ...OTHER, headline: 'The change (#77)' }]) })
  expect({ code: result.code, output: result.output }).toEqual({ code: 0, output: 'Auto-merge (squash) is on for owner/repo#7 at c0ffee1.\n' })
  expect(result.error).toContain('HTTP 502')
  expect(autoMerges(result.calls)).toHaveLength(2)
})

test('a 5xx on a PR GitHub has merged meanwhile says so, and writes nothing more (#577)', async () => {
  const result = await runFromNonClone('agent-bot[bot]', { ...NO_WAIT, FAKE_AUTO_STATUS: '503', FAKE_LANDED: afterServerError('MERGED', [OTHER], { mergeCommit: 'bbbbbbb2' }) })
  expect({ code: result.code, output: result.output }).toEqual({ code: 0, output: 'Merged: owner/repo#7 is merged as bbbbbbb2 (GitHub answered HTTP 503 first).\n' })
  expect(autoMerges(result.calls)).toHaveLength(1)
})

test.each([
  ['set to auto-merge', { autoMerge: true }],
  ['in the merge queue', { queued: true }],
] as const)('a 5xx on an auto-merge request that went through anyway, the PR now %s, says so, and writes nothing more (#579)', async (where, flags) => {
  const result = await runFromNonClone('agent-bot[bot]', { ...NO_WAIT, FAKE_LANDED: afterServerError('OPEN', [OTHER], flags) })
  expect({ code: result.code, output: result.output }).toEqual({ code: 0, output: `owner/repo#7 is ${where} (GitHub answered HTTP 502 first).\n` })
  expect(autoMerges(result.calls)).toHaveLength(1)
})

test('after a 5xx it waits before reading the PR again, so a write GitHub is still finishing shows (#579)', async () => {
  const result = await runFromNonClone('agent-bot[bot]', { ...NO_WAIT, AGENT_QUEUE_5XX_WAIT_SECONDS: '1', FAKE_LANDED: afterServerError('OPEN', [OTHER]) })
  expect(result.code).toBe(0)
  expect(result.ms).toBeGreaterThanOrEqual(1000)
})

test('a 5xx without a Date header still finds a squash committed a little before the local clock (#581)', async () => {
  // The local clock runs ahead of GitHub's: the squash's commit date is a few seconds before the write, by the local clock.
  const landed = { date: Temporal.Now.instant().subtract({ seconds: 10 }).toString(), headline: 'The change (#7)', oid: 'fb7bb5f0', tree: HEAD_TREE }
  const result = await runFromNonClone('agent-bot[bot]', { ...NO_WAIT, FAKE_AUTO_NO_DATE: '1', FAKE_LANDED: afterServerError('OPEN', [OTHER, landed]) })
  expect(result.code).toBe(3)
  expect(result.error).toContain('owner/repo#7 landed on main as fb7bb5f0')
  expect(autoMerges(result.calls)).toHaveLength(1)
})

test('after a rate-limit wait, a 5xx counts only commits after the try GitHub answered with it (#581)', async () => {
  // The first try is refused for a rate limit and waited out; a commit naming the PR lands during that wait, before the try that got the 5xx.
  const during = { date: Temporal.Now.instant().add({ milliseconds: 1500 }).toString(), headline: 'Cherry-picked from (#7)', oid: 'ccccccc3', tree: 'tree-other' }
  const result = await runFromNonClone('agent-bot[bot]', { ...NO_WAIT, FAKE_AUTO_LIMIT: '5', FAKE_LANDED: afterServerError('OPEN', [OTHER, during]) })
  expect({ code: result.code, output: result.output }).toEqual({ code: 0, output: 'Auto-merge (squash) is on for owner/repo#7 at c0ffee1.\n' })
  expect(autoMerges(result.calls)).toHaveLength(3)
}, 20_000)

test.each([
  ['the same tree as the head', { headline: 'An older change', oid: 'ccccccc3', tree: HEAD_TREE }],
  ['a commit naming the PR', { headline: 'Cherry-picked from (#7)', oid: 'ccccccc3', tree: 'tree-other' }],
] as const)('a 5xx without a Date header still leaves out a commit with %s committed well before the 30 s margin (#583)', async (_name, older) => {
  // A minute before the local clock: past the margin for a clock running ahead, so it can't be the write's squash.
  const before = { ...older, date: Temporal.Now.instant().subtract({ minutes: 1 }).toString() }
  const result = await runFromNonClone('agent-bot[bot]', { ...NO_WAIT, FAKE_AUTO_NO_DATE: '1', FAKE_LANDED: afterServerError('OPEN', [OTHER, before]) })
  expect({ code: result.code, output: result.output }).toEqual({ code: 0, output: 'Auto-merge (squash) is on for owner/repo#7 at c0ffee1.\n' })
  expect(autoMerges(result.calls)).toHaveLength(2)
})
