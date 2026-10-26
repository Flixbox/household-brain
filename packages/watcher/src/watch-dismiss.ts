/**
 * Dismisses a bot's stale change request, where the repository opts in (#285): once the owner approved
 * and no review thread is open, a bot's CHANGES_REQUESTED left on an older commit only keeps GitHub
 * from merging (it counts until dismissed). Which ones is `reviewsToDismiss`.
 *
 * DISMISS_STALE_BOT_REVIEWS=1 switches it on; off by default, when `BLOCKED_BY_REVIEW` names such a
 * change request for the owner to dismiss instead. The `GH` token must be allowed to write pull requests.
 */
import { type Review, type ReviewThread, dismissedReviewEvent, reviewsToDismiss } from './watch-review-events'
import { REPO, gh } from './watch-github'
import { GH } from './watch-gh'
import { report } from './watch-output'
import { allSettled } from './read'
import { record, textOf } from './watch-text'

const DISMISS_STALE_BOT_REVIEWS = process.env.DISMISS_STALE_BOT_REVIEWS === '1'

const MESSAGE = 'Dismissed by the project watcher: the owner approved a newer commit, and no review thread is open (DISMISS_STALE_BOT_REVIEWS).'

const reviewPath = (pr: number, id: number) => `repos/${REPO}/pulls/${pr}/reviews/${id}`

/**
 * Dismisses a review with the `GH` token; never a shared answer. A refusal still counts when the review
 * is dismissed by now: another watcher of the repository (#264) may have been first.
 */
const dismiss = async (pr: number, id: number): Promise<boolean> => {
  const dismissed = (value: unknown) => textOf(record(value).state) === 'DISMISSED'
  return gh(['api', '-X', 'PUT', `${reviewPath(pr, id)}/dismissals`, '-f', `message=${MESSAGE}`, '-f', 'event=DISMISS'], GH, true)
    .then(dismissed, async () => gh(['api', reviewPath(pr, id)], GH, true).then(dismissed, () => false))
}

/**
 * For a PR the owner approved (the caller checks): dismisses what `reviewsToDismiss` names, when the
 * setting is on, and reports each, a failure once (it is tried again on every look). Returns the
 * reviews with the dismissed ones marked so, for what still blocks the merge.
 */
export const dismissStale = async ({ head, pr, reviews, threads }: {
  head: string
  pr: number
  reviews: Review[]
  threads: ReviewThread[]
}): Promise<{ reviews: Review[], threads: ReviewThread[] }> => {
  const dismissed = new Set<number>()
  const toDismiss = DISMISS_STALE_BOT_REVIEWS ? reviewsToDismiss({ head, reviews, threads }) : []
  await allSettled(toDismiss.map(async review => {
    const done = await dismiss(pr, review.id)
    if (done) {
      dismissed.add(review.id)
    }
    await report(dismissedReviewEvent(pr, review, done), pr)
  }))
  return { reviews: reviews.map(review => (dismissed.has(review.id) ? { ...review, state: 'DISMISSED' } : review)), threads }
}
