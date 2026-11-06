/** Queues a pull request once it may be queued (#354). Not written yet: the tests come first. */

/** One check on the PR's head. */
export interface Check {
  name: string
  result: string
  workflow: boolean
}

/** One review, oldest first. */
export interface Review {
  login: string
  state: string
}

/** What decides whether a PR may be queued. */
export interface PrFacts {
  autoMerge: boolean
  checks: readonly Check[]
  draft: boolean
  labels: readonly string[]
  openThreads: number
  queued: boolean
  reviews: readonly Review[]
  state: string
}

/** Why the PR may not be queued yet; none so far. */
export const blockersOf = (_facts: PrFacts, _owner: string): string[] => []

/** The facts in GitHub's answer; nothing read so far. */
export const factsFrom = (_pr: unknown): PrFacts => ({ autoMerge: false, checks: [], draft: false, labels: [], openThreads: 0, queued: false, reviews: [], state: '' })
