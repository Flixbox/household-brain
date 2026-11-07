/**
 * Whether the watcher takes the `question` label off a PR that no longer needs the owner (#371), and what
 * it reports (pure, so it is tested): once the owner's latest review approves it, on any commit (the
 * approval is permanent, #317), or once it merged or closed. Issues keep the label until answered. The
 * side of it that writes to GitHub is in watch-question.ts.
 */
import type { Event } from './watch-events'

// QUESTION_LABEL: the label for work that waits on the owner; `question` by default.
export const QUESTION_LABEL = process.env.QUESTION_LABEL ?? 'question'
// CLEAR_QUESTION_LABEL=1 switches it on; off by default. It writes with the `GH` token, and only where
// GitHub says that token is a bot's (`isBotLogin`): with the owner's own login it never takes it off.
export const CLEAR_QUESTION_LABEL = process.env.CLEAR_QUESTION_LABEL === '1'

/** What decides it: the commit the owner's latest review approves ('' when none), the label, the PR's state. */
export interface QuestionFacts {
  approvedCommit: string
  enabled: boolean
  labelled: boolean
  state: string
}

/** Whether `login`, GitHub's `viewer` for the `GH` token, is a bot's (`name[bot]`); '' (unknown) isn't. */
export const isBotLogin = (login: string): boolean => login.endsWith('[bot]')

/** Whether the watcher takes QUESTION_LABEL off: on, labelled, and approved by the owner, merged or closed. */
export const clearsQuestion = ({ approvedCommit, enabled, labelled, state }: QuestionFacts): boolean =>
  enabled && labelled && (approvedCommit !== '' || state === 'MERGED' || state === 'CLOSED')

/** Why the PR no longer needs the owner. */
const because = (approved: string, state: string): string => {
  if (state === 'MERGED' || state === 'CLOSED') {
    return `the PR is ${state.toLowerCase()}`
  }
  return `the owner approved it (at ${approved.slice(0, 7)}; the approval is permanent)`
}

/** The event for the label taken off (`removed`), or not: once per head, a failure under its own key. */
export const questionClearedEvent = ({ approved, head, pr, removed, state }: { approved: string, head: string, pr: number, removed: boolean, state: string }): Event => removed
  ? { key: `pr-${pr} question-cleared ${head}`, lines: [`QUESTION_CLEARED: ${because(approved, state)}, so the watcher took the \`${QUESTION_LABEL}\` label off (CLEAR_QUESTION_LABEL). Nothing to do.`] }
  : { key: `pr-${pr} question-clear-failed ${head}`, lines: [`QUESTION_CLEAR_FAILED: couldn't take the \`${QUESTION_LABEL}\` label off (it tries again on every look); check the GH token may write issues (labels are an issue's, also on a PR)`] }
