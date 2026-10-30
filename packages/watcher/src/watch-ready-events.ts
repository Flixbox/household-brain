/**
 * Whether the watcher marks an approved draft ready itself (#301), and what it reports (pure, so it is
 * tested). READY_APPROVED_DRAFTS=1 switches it on; off by default, when APPROVED_DRAFT asks the agent
 * to mark it ready instead (#298). The side of it that writes to GitHub is in watch-approval.ts.
 */
import type { Event } from './watch-events'

export const READY_APPROVED_DRAFTS = process.env.READY_APPROVED_DRAFTS === '1'

const COUNTING = new Set(['APPROVED', 'CHANGES_REQUESTED', 'DISMISSED'])

/**
 * The commit `owner`'s own latest counting review (a comment doesn't undo an approval) approves, on
 * any commit (#317: an approval stays when the agent rebases after it); '' when that review isn't an
 * approval. Never a bot's: a bot (`name[bot]`) set as the owner approves nothing here.
 */
export const ownerApprovalCommit = (reviews: readonly { commit: string, login: string, state: string }[], owner: string): string => {
  const latest = reviews.findLast(review => review.login.toLowerCase() === owner.toLowerCase() && COUNTING.has(review.state))
  return !owner.endsWith('[bot]') && latest?.state === 'APPROVED' ? latest.commit : ''
}

/**
 * Whether the watcher marks the PR ready: switched on (`enabled`), a draft, and the owner's latest
 * review approves it (`approvedCommit`, on any commit, #317). Merging still waits for CI and, where a
 * review bot was asked (#324), its review.
 */
export const marksReady = ({ approvedCommit, draft, enabled }: { approvedCommit: string, draft: boolean, enabled: boolean }): boolean =>
  enabled && draft && approvedCommit !== ''

/** The approved commit, and the head too where the approval was on an older one (#317). */
const approvedAt = (approved: string, head: string): string => (approved === head
  ? `the draft's head (${head.slice(0, 7)})`
  : `the draft at ${approved.slice(0, 7)}, before its head ${head.slice(0, 7)}`)

/** The event for a draft the watcher marked ready (`readied`), or failed to: once per head. `approved` is the commit the owner approved. */
export const draftReadiedEvent = ({ approved, head, pr, readied }: { approved: string, head: string, pr: number, readied: boolean }): Event => readied
  ? { key: `pr-${pr} draft-readied ${head}`, lines: [`DRAFT_READIED: the owner approved ${approvedAt(approved, head)}, so the watcher marked it ready (READY_APPROVED_DRAFTS): queue once CI is green (after the review a bot was asked for, if any, and its threads settled)`] }
  : { key: `pr-${pr} draft-ready-failed ${head}`, lines: ['DRAFT_READY_FAILED: couldn\'t mark the approved draft ready (it tries again on every look; see APPROVED_DRAFT); check the GH token may write pull requests'] }

/** What the APPROVED event says about a draft: who marks it ready. */
export const draftNote = (enabled: boolean): string => (enabled
  ? 'It is a draft: the watcher marks it ready once the owner approved it, on any commit (DRAFT_READIED).'
  : 'It is a draft: mark it ready first (see APPROVED_DRAFT).')
