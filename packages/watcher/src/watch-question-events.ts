/**
 * Whether the watcher takes the `question` label off a PR that no longer needs the owner (#371), pure so
 * it is tested. Not done yet: today an approved, merged or closed PR keeps the label.
 */

/** What decides it: the commit the owner's latest review approves ('' when none), the label, the PR's state. */
export interface QuestionFacts {
  approvedCommit: string
  enabled: boolean
  labelled: boolean
  state: string
}

/** Never, so far (#371). */
export const clearsQuestion = (_facts: QuestionFacts): boolean => false
