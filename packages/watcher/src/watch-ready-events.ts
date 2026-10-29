/**
 * Whether the watcher marks an approved draft ready itself (#301), and what it reports (pure, so it is
 * tested). READY_APPROVED_DRAFTS=1 switches it on; off by default, when APPROVED_DRAFT asks the agent
 * to mark it ready instead (#298). The side of it that writes to GitHub is in watch-approval.ts.
 */
import type { Event } from './watch-events'

export const READY_APPROVED_DRAFTS = process.env.READY_APPROVED_DRAFTS === '1'

/** The reported keys that say PR `pr` was approved as a draft, at any head: APPROVED_DRAFT's, or DRAFT_READIED's. */
export const draftKeys = (pr: number): string[] => [`pr-${pr} approved-draft `, `pr-${pr} draft-readied `]

/** Whether PR `pr` was approved as a draft at `head` (APPROVED_DRAFT or DRAFT_READIED reported there). */
export const wasDraftAt = (reported: readonly string[], pr: number, head: string): boolean =>
  draftKeys(pr).some(key => reported.includes(`${key}${head}`))

const COUNTING = new Set(['APPROVED', 'CHANGES_REQUESTED', 'DISMISSED'])

/**
 * Whether `owner`'s own latest counting review (a comment doesn't undo an approval) approves commit
 * `head`. Never a bot's: a bot (`name[bot]`) set as the owner approves nothing here.
 */
export const ownerApprovedHead = (reviews: readonly { commit: string, login: string, state: string }[], owner: string, head: string): boolean => {
  const latest = reviews.findLast(review => review.login.toLowerCase() === owner.toLowerCase() && COUNTING.has(review.state))
  return !owner.endsWith('[bot]') && latest?.state === 'APPROVED' && latest.commit === head
}

/** Whether the watcher marks the PR ready: switched on (`enabled`), a draft, and the owner approved its head. */
export const marksReady = ({ draft, enabled, ownerApprovedHead: approved }: { draft: boolean, enabled: boolean, ownerApprovedHead: boolean }): boolean =>
  enabled && draft && approved

/** The event for a draft the watcher marked ready (`readied`), or failed to: once per head. */
export const draftReadiedEvent = ({ head, pr, readied }: { head: string, pr: number, readied: boolean }): Event => readied
  ? { key: `pr-${pr} draft-readied ${head}`, lines: [`DRAFT_READIED: the owner approved the draft's head (${head.slice(0, 7)}), so the watcher marked it ready (READY_APPROVED_DRAFTS): wait for the bot review, settle its threads, then queue`] }
  : { key: `pr-${pr} draft-ready-failed ${head}`, lines: ['DRAFT_READY_FAILED: couldn\'t mark the approved draft ready (it tries again on every look; see APPROVED_DRAFT); check the GH token may write pull requests'] }

/** What the APPROVED event says about a draft: who marks it ready. */
export const draftNote = (enabled: boolean): string => (enabled
  ? 'It is a draft: the watcher marks it ready once the owner approved its head (DRAFT_READIED).'
  : 'It is a draft: mark it ready first (see APPROVED_DRAFT).')
