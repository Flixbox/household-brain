/**
 * A PR the main session cleared for queueing without the owner's approval (#327), pure so it is tested:
 * where its settled bot change requests are dismissed as on an approved one (watch-dismiss.ts), and
 * which: only those submitted before the label was last put on, so a bot's later change request (on
 * new commits) needs a new clearance. The label stays on; nothing needs taking off or retrying.
 */
import { type Json, actor, record } from './watch-text'
import type { Dismissal } from './watch-review-events'
import { textOf } from './read'

// CLEARED_LABEL: the label the main session puts on a PR it cleared for queueing without the owner's
// approval (#327), after a review subagent's clean review; `subagent-cleared` by default. With
// DISMISS_STALE_BOT_REVIEWS on, such a PR's settled bot change requests are dismissed as on an approved one.
export const CLEARED_LABEL = process.env.CLEARED_LABEL ?? 'subagent-cleared'

/**
 * Whether the watcher dismisses settled bot change requests on a PR the owner hasn't approved (#327):
 * where the repository opts in (`enabled`), the PR carries CLEARED_LABEL (`cleared`), changes are
 * requested, CI is `green` at the head and it is no draft. One the owner approved goes the usual way.
 */
export const dismissesCleared = ({ cleared, decision, draft, enabled, green, ownerApproved }: {
  cleared: boolean
  decision: string
  draft: boolean
  enabled: boolean
  green: boolean
  ownerApproved: boolean
}): boolean => enabled && cleared && decision === 'CHANGES_REQUESTED' && green && !draft && !ownerApproved

/**
 * When CLEARED_LABEL was last put on the PR by one of `clearers` (the owner and the agent), from its
 * `LabeledEvent`s and `UnlabeledEvent`s (oldest first: `kind`, `createdAt`, `actor`, `label.name`); ''
 * when never, or when it was taken off since. Someone else putting it on clears nothing.
 */
export const clearedAt = (events: readonly Json[], clearers: readonly string[]): string => {
  const allowed = new Set(clearers.filter(login => login !== '').map(login => login.toLowerCase()))
  const counts = (event: Json) => event.kind === 'UnlabeledEvent' || (event.kind === 'LabeledEvent' && allowed.has(actor(event.actor).toLowerCase()))
  const last = events.findLast(event => textOf(record(event.label).name) === CLEARED_LABEL && counts(event))
  return last?.kind === 'LabeledEvent' ? textOf(last.createdAt) : ''
}

/** Whether `earlier` is before `later`; a time that isn't one counts as not. */
const before = (earlier: string, later: string): boolean => {
  try {
    return Temporal.Instant.compare(Temporal.Instant.from(earlier), Temporal.Instant.from(later)) < 0
  } catch {
    return false
  }
}

/** The dismissals a clearance at `at` covers: change requests submitted before it; none without one. */
export const coveredByClearance = (dismissals: readonly Dismissal[], at: string): Dismissal[] =>
  dismissals.filter(({ review }) => before(review.submittedAt, at))
