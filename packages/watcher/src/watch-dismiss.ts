/**
 * Dismisses a bot's settled change request, where the repository opts in: once the owner approved and
 * no review thread is open unsettled, a bot's CHANGES_REQUESTED left on an older commit (#285), or on the
 * head once the agent or the owner settled it with `Resolved:` replies (#290), only keeps GitHub from
 * merging (it counts until dismissed). Which ones is `reviewsToDismiss`.
 *
 * DISMISS_STALE_BOT_REVIEWS=1 switches it on; off by default, when `BLOCKED_BY_REVIEW` names such a
 * change request for the owner to dismiss instead. The `GH` token must be allowed to write pull requests.
 */
import { type PrComment, type Review, type ReviewThread, dismissalMessage, dismissedReviewEvent, reviewsToDismiss } from './watch-review-events'
import { OWNER, REPO, SELF, gh } from './watch-github'
import { GH } from './watch-gh'
import { report } from './watch-output'
import { allSettled, textOf } from './read'
import { record } from './watch-text'

const DISMISS_STALE_BOT_REVIEWS = process.env.DISMISS_STALE_BOT_REVIEWS === '1'

const isDismissed = (value: unknown) => textOf(record(value).state) === 'DISMISSED'

const reviewPath = (pr: number, id: number) => `repos/${REPO}/pulls/${pr}/reviews/${id}`

/**
 * Dismisses a review with the `GH` token; never a shared answer. A refusal still counts when the review
 * is dismissed by now: another watcher of the repository (#264) may have been first.
 */
const dismiss = async (pr: number, id: number, message: string): Promise<boolean> => {
  const done = await gh(['api', '-X', 'PUT', `${reviewPath(pr, id)}/dismissals`, '-f', `message=${message}`, '-f', 'event=DISMISS'], GH, true).then(isDismissed, () => false)
  return done || gh(['api', reviewPath(pr, id)], GH, true).then(isDismissed, () => false)
}

/**
 * For a PR the owner approved (the caller checks): dismisses what `reviewsToDismiss` names, when the
 * setting is on, and reports each, a failure once (it is tried again on every look). Returns the
 * reviews with the dismissed ones marked so, for what still blocks the merge.
 */
export const dismissStale = async ({ comments, head, pr, reviews, threads }: {
  comments: PrComment[]
  head: string
  pr: number
  reviews: Review[]
  threads: ReviewThread[]
}): Promise<{ reviews: Review[], threads: ReviewThread[] }> => {
  const dismissed = new Set<number>()
  const toDismiss = DISMISS_STALE_BOT_REVIEWS ? reviewsToDismiss({ comments, head, reviews, settlers: [SELF, OWNER], threads }) : []
  await allSettled(toDismiss.map(async dismissal => {
    const done = await dismiss(pr, dismissal.review.id, dismissalMessage(dismissal))
    if (done) {
      dismissed.add(dismissal.review.id)
    }
    await report(dismissedReviewEvent(pr, head, dismissal, done), pr)
  }))
  return { reviews: reviews.map(review => (dismissed.has(review.id) ? { ...review, state: 'DISMISSED' } : review)), threads }
}
