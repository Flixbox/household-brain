/**
 * What a PR the owner approved asks of the watcher, checked once its comments were read: READY_TO_MERGE
 * or APPROVED_DRAFT while auto-merge is off (#298, #299), what blocks an approved, green PR (#278), and
 * asking a review bot to resolve (#303). Where the repository opts in with READY_APPROVED_DRAFTS=1
 * (#301), it marks a draft ready itself once the owner's latest review approves it, on any commit
 * (#317): a draft can't be queued and a review bot skips it, so the owner's approval is the go-ahead.
 * Merging still waits for CI and, where a review bot was asked (#324), its review. Which drafts is
 * `marksReady` (watch-ready-events.ts). The `GH` token must then be allowed to write pull requests.
 */
import { DISMISS_STALE_BOT_REVIEWS, askBotsToResolve, dismissCleared, dismissStale, reviewBlockers } from './watch-dismiss'
import { type PrState, REPO, SELF, mergeCommand, readyCommand } from './watch-github'
import { READY_APPROVED_DRAFTS, draftNote, draftReadiedEvent, marksReady } from './watch-ready-events'
import { approvedEvent, blockedByReviewEvent } from './watch-review-events'
import { dismissesCleared } from './watch-cleared-events'
import { askBotReviews } from './watch-bot-review'
import { awaitsBotReview } from './watch-bot-review-events'
import { GH, ghText } from './watch-gh'
import { askedBots, readLines } from './watch-state'
import { report } from './watch-output'

/** What the APPROVED event says about a draft: who marks it ready. */
export const APPROVED_DRAFT_NOTE = draftNote(READY_APPROVED_DRAFTS)

/**
 * Marks PR `pr` ready where `marksReady` says so, with the `GH` token, and reports it. True when it
 * did; false when it wasn't asked to, or failed (reported once per head, tried again on every look),
 * and APPROVED_DRAFT then asks the agent. Another watcher that marked it ready first leaves `gh pr
 * ready` nothing to do, which still succeeds.
 */
const readyApprovedDraft = async (pr: number, state: PrState): Promise<boolean> => {
  if (!marksReady({ approvedCommit: state.ownerApprovalCommit, draft: state.draft, enabled: READY_APPROVED_DRAFTS })) {
    return false
  }
  const readied = await ghText(['pr', 'ready', String(pr), '--repo', REPO], GH, true).then(() => true, () => false)
  await report(draftReadiedEvent({ approved: state.ownerApprovalCommit, head: state.head, pr, readied }), pr)
  return readied
}

/**
 * For a PR the owner approved with auto-merge off: READY_TO_MERGE once CI is `green`, or for a draft
 * DRAFT_READIED where the watcher marks it ready itself, else APPROVED_DRAFT (`approvedEvent`).
 */
const checkAutoMergeOff = async ({ green, pr, state }: { green: boolean, pr: number, state: PrState }): Promise<void> => {
  // A PR in the merge queue shows auto-merge as off: it waits on the queue, not on the agent (#251).
  // Out of draft, READY_TO_MERGE waits for the review a bot was asked for, or one in progress (#299, #324).
  const asked = await askedBots(pr)
  const held = !state.draft && awaitsBotReview({ asked, state: state.bot })
  const waits = state.decision === 'APPROVED' && !state.autoMerge && !state.queued && !held
  if (!waits || await readyApprovedDraft(pr, state)) {
    return
  }
  await report(approvedEvent({ botAsked: asked.length > 0, draft: state.draft, green, head: state.head, merge: mergeCommand(pr), pr, ready: readyCommand(pr) }), pr)
}

/**
 * Approved and green, yet GitHub won't merge it (#278): what in the reviews blocks it, after dismissing
 * a settled bot change request where the repository opts in (#285, #290). Asked only while GitHub says it is
 * blocked; a lookup that fails says nothing, and the next look asks again.
 */
const checkBlocked = async (pr: number, head: string): Promise<void> => {
  const blockers = await reviewBlockers(pr).then(async found => dismissStale({ ...found, head, pr })).catch(() => null)
  await report(blockers && blockedByReviewEvent({ ...blockers, dismiss: DISMISS_STALE_BOT_REVIEWS, head, pr, self: SELF }), pr)
}

/**
 * Approved and green for the current head, but auto-merge is still off or it is a draft (#298), or
 * GitHub blocks the merge (#278, #286); not approved but labelled as cleared without the owner, a
 * settled bot change request to dismiss (#327); then a review bot to ask to resolve (#303).
 */
export const checkApproval = async (pr: number, state: PrState): Promise<void> => {
  // A review bot asked for once, on the label (#324), before what waits on it.
  await (state.bot.requested ? askBotReviews(pr) : Promise.resolve())
  const reported = await readLines('reported')
  const green = reported.includes(`pr-${pr} ci-passed ${state.head}`)
  await checkAutoMergeOff({ green, pr, state })
  // The owner's own approval, not the decision: a stale change request, one of the causes it names,
  // keeps GitHub's decision at CHANGES_REQUESTED (#286).
  await (state.ownerApproved && green && state.mergeState === 'BLOCKED' ? checkBlocked(pr, state.head) : Promise.resolve())
  const cleared = dismissesCleared({ ...state, enabled: DISMISS_STALE_BOT_REVIEWS, green })
  await (cleared ? dismissCleared(pr, state.head) : askBotsToResolve(pr, state))
}
