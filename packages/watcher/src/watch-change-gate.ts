/**
 * Asks GitHub about a pull request in full only when something about it changed (#404). Each look
 * starts with one cheap question, the newest pull requests' `updatedAt` and the few facts that move
 * without touching it: the head, whether it can merge, the merge queue, auto-merge and CI's overall
 * state. A PR whose answer differs, that wasn't in it, or that wasn't read for FULL_READ_MINUTES is
 * read in full; for the others the last answer stands. When the question fails, every PR is read.
 */
 // Probe for #444, never merged: a line for a review thread to sit on.
import { type FullRead, duePrs } from './watch-change-due'
import { type PrState, graphql, lastStates, prStates } from './watch-github'
import { type Json, at, count, records } from './watch-text'

const GATE_FIELDS = 'pullRequests(first:100,orderBy:{field:UPDATED_AT,direction:DESC}){nodes{number updatedAt headRefOid state mergeable mergeStateStatus isInMergeQueue autoMergeRequest{enabledAt} commits(last:1){nodes{commit{statusCheckRollup{state}}}}}}'

/** What the gate says about each PR, as one comparable text; a PR not among them has none. */
const printsFrom = (repository: Json): Map<number, string> =>
  new Map(records(at(repository, 'pullRequests', 'nodes')).map(pr => [count(pr.number), JSON.stringify(pr)]))

/** The look in progress: states and activity ask at the same moment, and share one question. */
const asking: { prints: Promise<Map<number, string>> | null } = { prints: null }

const gatePrints = async (): Promise<Map<number, string>> => {
  asking.prints ??= graphql(GATE_FIELDS).then(printsFrom, () => new Map<number, string>()).finally(() => { asking.prints = null })
  return asking.prints
}

/**
 * Remembers one kind of full read. `settle` is called with the PRs actually read: one whose read
 * failed stays due. The gate is asked before the read, so a change during the read shows as due next look.
 */
export const changeTracker = () => {
  const known = new Map<number, FullRead>()
  return {
    look: async (prs: readonly number[]) => {
      const prints = await gatePrints()
      const now = Temporal.Now.instant().epochMilliseconds
      return {
        due: duePrs({ known, now, prints, prs }),
        settle: (read: Iterable<number>) => { for (const pr of read) { known.set(pr, { at: now, print: prints.get(pr) ?? '' }) } },
      }
    },
  }
}

const stateReads = changeTracker()

/**
 * Each PR's state, read in full only when due (see `duePrs`), always from GitHub then: an answer
 * shared from before the change would be remembered as the changed PR's state. A due PR that couldn't
 * be read is missing, as in `prStates`.
 */
export const changedStates = async (prs: readonly number[]): Promise<Map<number, PrState>> => {
  const { due, settle } = await stateReads.look(prs)
  const read = await prStates(due, true)
  settle(read.keys())
  for (const [pr, state] of read) { lastStates.set(pr, state) }
  const failed = new Set(due.filter(pr => !read.has(pr)))
  return new Map(prs.flatMap((pr): [number, PrState][] => {
    const state = lastStates.get(pr)
    return state && !failed.has(pr) ? [[pr, state]] : []
  }))
}
