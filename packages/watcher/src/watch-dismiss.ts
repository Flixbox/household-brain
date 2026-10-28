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
import { OWNER, REPO, SELF, actor, at, gh, graphql, threadsFrom } from './watch-github'
import { GH } from './watch-gh'
import { report } from './watch-output'
import { allSettled, textOf } from './read'
import { count, record, records } from './watch-text'

export const DISMISS_STALE_BOT_REVIEWS = process.env.DISMISS_STALE_BOT_REVIEWS === '1'

/** A PR's review threads (as `THREAD_FIELDS` in watch-github.ts), with the review that opened each thread (its first comment's), which the dismissal needs (#290). */
const THREAD_REVIEW_FIELDS = 'reviewThreads(first:100){pageInfo{hasNextPage} nodes{id isResolved comments(last:1){nodes{body url author{login kind:__typename}}} first:comments(first:1){nodes{pullRequestReview{databaseId}}}}}'

/**
 * A PR's review threads (see `THREAD_REVIEW_FIELDS`), its reviews with the commit each was left on
 * (#278), its id (#285) and when, and its last hundred PR comments, where a review without threads is
 * settled (#290). `complete` says every thread was read: with more, the watcher dismisses nothing.
 * `fresh` asks GitHub even when another watcher just did (#264), for a comment that must not be posted twice (#303).
 */
export const reviewBlockers = async (pr: number, fresh = false): Promise<{ comments: PrComment[], complete: boolean, reviews: Review[], threads: ReviewThread[] }> => {
  const fields = `${THREAD_REVIEW_FIELDS} reviews(last:100){nodes{databaseId state submittedAt commit{oid} author{login kind:__typename}}}`
    + ' comments(last:100){nodes{body url createdAt author{login kind:__typename}}}'
  const value = record(at(await graphql(`pullRequest(number:${pr}){${fields}}`, fresh), 'pullRequest'))
  return {
    comments: records(at(value, 'comments', 'nodes'))
      .map(comment => ({ author: actor(comment.author), body: textOf(comment.body), createdAt: textOf(comment.createdAt), url: textOf(comment.url) })),
    complete: at(value, 'reviewThreads', 'pageInfo', 'hasNextPage') === false,
    reviews: records(at(value, 'reviews', 'nodes')).map(review => ({
      commit: textOf(record(review.commit).oid),
      id: count(review.databaseId),
      login: actor(review.author),
      state: textOf(review.state),
      submittedAt: textOf(review.submittedAt),
    })),
    threads: threadsFrom(value),
  }
}

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
export const dismissStale = async ({ comments, complete, head, pr, reviews, threads }: {
  comments: PrComment[]
  complete: boolean
  head: string
  pr: number
  reviews: Review[]
  threads: ReviewThread[]
}): Promise<{ reviews: Review[], threads: ReviewThread[] }> => {
  const dismissed = new Set<number>()
  const toDismiss = DISMISS_STALE_BOT_REVIEWS ? reviewsToDismiss({ comments, complete, head, reviews, settlers: [SELF, OWNER], threads }) : []
  await allSettled(toDismiss.map(async dismissal => {
    const done = await dismiss(pr, dismissal.review.id, dismissalMessage(dismissal))
    if (done) {
      dismissed.add(dismissal.review.id)
    }
    await report(dismissedReviewEvent({ dismissal, dismissed: done, head, pr }), pr)
  }))
  return { reviews: reviews.map(review => (dismissed.has(review.id) ? { ...review, state: 'DISMISSED' } : review)), threads }
}
