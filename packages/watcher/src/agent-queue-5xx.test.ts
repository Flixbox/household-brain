import { afterEach, expect, test } from 'bun:test'
import { removeRuns, runFromNonClone } from './agent-queue-fixture'

afterEach(removeRuns)

const HEAD_TREE = 'tree-of-head'
/** What the PR and the top of its base branch look like after a write GitHub answered with a 5xx (#577): `commits`, newest first. */
const afterServerError = (state: string, commits: readonly { headline: string, oid: string, tree: string }[], mergeCommit: string | null = null) => JSON.stringify({
  baseRef: { target: { history: { nodes: commits.map(({ headline, oid, tree }) => ({ messageHeadline: headline, oid, tree: { oid: tree } })) } } },
  commits: { nodes: [{ commit: { tree: { oid: HEAD_TREE } } }] },
  mergeCommit: mergeCommit === null ? null : { oid: mergeCommit },
  state,
})
const OTHER = { headline: 'Something else (#6)', oid: 'aaaaaaa1', tree: 'tree-other' }
const autoMerges = (calls: readonly string[]) => calls.filter(call => call.includes('enablePullRequestAutoMerge'))

test.each([
  ['the same tree as the head', { headline: 'A squash with a new title', oid: 'fb7bb5f0', tree: HEAD_TREE }],
  ['a commit naming the PR', { headline: 'The change (#5) (#7)', oid: 'fb7bb5f0', tree: 'tree-after-main-moved' }],
] as const)('a 5xx whose merge landed on main anyway, as %s, is reported as landed and not tried again (#577)', async (_name, landed) => {
  const result = await runFromNonClone('agent-bot[bot]', { FAKE_AUTO_STATUS: '502', FAKE_LANDED: afterServerError('OPEN', [OTHER, landed]) })
  expect(result.code).not.toBe(0)
  expect(result.output).toBe('')
  expect(result.error).toContain("owner/repo#7 landed on main as fb7bb5f0, but GitHub didn't mark the PR merged")
  expect(autoMerges(result.calls)).toHaveLength(1)
})

test('a 5xx whose merge did not land is tried once more (#577)', async () => {
  const result = await runFromNonClone('agent-bot[bot]', { FAKE_AUTO_STATUS: '502', FAKE_LANDED: afterServerError('OPEN', [OTHER, { ...OTHER, headline: 'The change (#77)' }]) })
  expect({ code: result.code, output: result.output }).toEqual({ code: 0, output: 'Auto-merge (squash) is on for owner/repo#7 at c0ffee1.\n' })
  expect(result.error).toContain('HTTP 502')
  expect(autoMerges(result.calls)).toHaveLength(2)
})

test('a 5xx on a PR GitHub has merged meanwhile says so, and writes nothing more (#577)', async () => {
  const result = await runFromNonClone('agent-bot[bot]', { FAKE_AUTO_STATUS: '503', FAKE_LANDED: afterServerError('MERGED', [OTHER], 'bbbbbbb2') })
  expect({ code: result.code, output: result.output }).toEqual({ code: 0, output: 'Merged: owner/repo#7 is merged as bbbbbbb2 (GitHub answered HTTP 503 first).\n' })
  expect(autoMerges(result.calls)).toHaveLength(1)
})
