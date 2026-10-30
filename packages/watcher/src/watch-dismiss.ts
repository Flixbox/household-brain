/**
 * Dismisses a bot's settled change request, where the repository opts in: once the owner approved and
 * no review thread is open unsettled, a bot's CHANGES_REQUESTED left on an older commit (#285), or on the
 * head once the agent or the owner settled it with `Resolved:` replies (#290), only keeps GitHub from
 * merging (it counts until dismissed). Which ones is `reviewsToDismiss`.
 *
 * DISMISS_STALE_BOT_REVIEWS=1 switches it on; off by default, when `BLOCKED_BY_REVIEW` names such a
 * change request for the owner to dismiss instead. The `GH` token must be allowed to write pull requests.
 *
 * Before the owner approves, it asks a bot to resolve such a change request instead, where the
 * repository names the bot in RESOLVE_BOT_REVIEWS (#303): `askBotsToResolve`. A PR the main session
 * labelled CLEARED_LABEL, cleared for queueing without the owner's approval, has its settled bot change
 * requests dismissed as on an approved one (#327): `dismissCleared`.
 */
import { CLEARED_LABEL, type PrComment, RESOLVE_BOT_REVIEWS, type Review, type ReviewThread, bare, botsToAskResolve, dismissalMessage, dismissedReviewEvent, resolveAskedEvent, resolveCommand, reviewsToDismiss } from './watch-review-events'
import { OWNER, type PrState, REPO, SELF, gh, graphql, threadsFrom } from './watch-github'
import { GH, ghText } from './watch-gh'
import { report } from './watch-output'
import { readLines } from './watch-state'
import { WATCHERS_DIR, claim, removeOlder, unclaim } from './watch-files'
import { allSettled, textOf } from './read'
import { actor, at, count, record, records } from './watch-text'

export const DISMISS_STALE_BOT_REVIEWS = process.env.DISMISS_STALE_BOT_REVIEWS === '1'

/** A PR's review threads (as `THREAD_FIELDS` in watch-github.ts), with the review that opened each thread (its first comment's), which the dismissal needs (#290). */
const THREAD_REVIEW_FIELDS = 'reviewThreads(first:100){pageInfo{hasNextPage} nodes{id isResolved comments(last:1){nodes{body url author{login kind:__typename}}} first:comments(first:1){nodes{pullRequestReview{databaseId}}}}}'

/**
 * A PR's review threads (see `THREAD_REVIEW_FIELDS`), its reviews with the commit each was left on
 * (#278), its id (#285) and when, and its last hundred PR comments, where a review without threads is
 * settled (#290). `complete` says every thread was read: with more, the watcher dismisses nothing.
 * And who opened it, for `askBotsToResolve` (#303).
 */
export const reviewBlockers = async (pr: number): Promise<{ author: string, comments: PrComment[], complete: boolean, reviews: Review[], threads: ReviewThread[] }> => {
  const fields = `${THREAD_REVIEW_FIELDS} reviews(last:100){nodes{databaseId state submittedAt commit{oid} author{login kind:__typename}}}`
    + ' comments(last:100){nodes{body url createdAt author{login kind:__typename}}} author{login kind:__typename}'
  const value = record(at(await graphql(`pullRequest(number:${pr}){${fields}}`), 'pullRequest'))
  return {
    author: actor(value.author),
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
 * For a PR the owner approved, or one labelled `cleared` (#327; the caller checks): dismisses what
 * `reviewsToDismiss` names, when the setting is on, and reports each, a failure once (it is tried again
 * on every look). Returns the reviews with the dismissed ones marked so, for what still blocks the
 * merge.
 */
export const dismissStale = async ({ cleared = '', comments, complete, head, pr, reviews, threads }: {
  cleared?: string
  comments: PrComment[]
  complete: boolean
  head: string
  pr: number
  reviews: Review[]
  threads: ReviewThread[]
}): Promise<{ reviews: Review[], threads: ReviewThread[] }> => {
  const dismissed = new Set<number>()
  const toDismiss = DISMISS_STALE_BOT_REVIEWS ? reviewsToDismiss({ comments, complete, head, owner: OWNER, reviews, self: SELF, threads }) : []
  await allSettled(toDismiss.map(async dismissal => {
    const done = await dismiss(pr, dismissal.review.id, dismissalMessage(dismissal, cleared))
    if (done) {
      dismissed.add(dismissal.review.id)
    }
    await report(dismissedReviewEvent({ cleared, dismissal, dismissed: done, head, pr }), pr)
  }))
  return { reviews: reviews.map(review => (dismissed.has(review.id) ? { ...review, state: 'DISMISSED' } : review)), threads }
}

/**
 * For a PR labelled CLEARED_LABEL that `dismissesCleared` picks (the caller checks): dismisses its
 * settled bot change requests as `dismissStale` does for an approved one (#327). The label stays: it
 * marks the PR cleared, like an approval, and keeps no state the watcher would have to retry. A
 * lookup that fails dismisses nothing; the next look asks again.
 */
export const dismissCleared = async (pr: number, head: string): Promise<void> => {
  const found = await reviewBlockers(pr).catch(() => null)
  await (found ? dismissStale({ ...found, cleared: CLEARED_LABEL, head, pr }) : Promise.resolve())
}

/** Where the asks to resolve are claimed (#303): one file per PR, head and bot, shared by this machine's watchers of the repository. */
const CLAIMS_DIR = `${WATCHERS_DIR}/${REPO.replace('/', '_')}/resolve-asked`
// A head asked about weeks ago is long gone: its claim is only taking up room.
await removeOlder(CLAIMS_DIR, Temporal.Duration.from({ hours: 24 * 14 }))

/** Comments `body` on PR `pr` with the `GH` token; false when it couldn't. */
export const comment = async (pr: number, body: string): Promise<boolean> =>
  ghText(['pr', 'comment', String(pr), '--repo', REPO, '--body', body], GH, true).then(() => true, () => false)

/**
 * Posts `@<bot> resolve` once among this machine's watchers (#264): only the one that claims it first,
 * also after a restart; a watcher on another machine sees the comment instead (`botsToAskResolve`).
 * Null when another one claimed it, else whether it was posted. A failed post gives the claim back,
 * to be tried again next look; a claim that can't be made counts as a failure, and nothing is posted.
 */
const askOnce = async (pr: number, head: string, login: string): Promise<boolean | null> => {
  const path = `${CLAIMS_DIR}/pr-${pr}-${head}-${bare(login)}`
  const claimed = await claim(path).then(made => (made ? 'claimed' : 'taken'), () => 'failed')
  if (claimed !== 'claimed') {
    return claimed === 'taken' ? null : false
  }
  const asked = await comment(pr, resolveCommand(login))
  await (asked ? Promise.resolve() : unclaim(path))
  return asked
}

/**
 * Asks a bot named in RESOLVE_BOT_REVIEWS to resolve its settled change request on the head (#303),
 * with `@<bot> resolve`: a bot (CodeRabbit) decides on approving only when it reviews a new commit, so
 * once its change request is settled it never approves by itself, and a low-risk PR waits for the
 * owner. The comment makes it resolve its threads and approve within its own `max_merge_risk`: the
 * watcher reads no risk rating. Only for a PR that changes are requested on, with CI passed at the
 * head, no draft, not the owner's and not approved by them (`dismissStale` handles that one; the caller
 * skips one `dismissCleared` handles, #327); which bots
 * is `botsToAskResolve`. Each ask is reported, a failure once (tried again on every look). A lookup
 * that fails asks nothing.
 */
export const askBotsToResolve = async (pr: number, state: PrState): Promise<void> => {
  const reported = await readLines('reported')
  const asked = reported.some(line => line.startsWith(`pr-${pr} bot-resolve-asked ${state.head} `))
  const eligible = state.decision === 'CHANGES_REQUESTED' && !state.draft && !state.ownerApproved && !asked
    && reported.includes(`pr-${pr} ci-passed ${state.head}`)
  const found = RESOLVE_BOT_REVIEWS.length > 0 && eligible ? await reviewBlockers(pr).catch(() => null) : null
  const toAsk = found && found.author.toLowerCase() !== OWNER.toLowerCase() ? botsToAskResolve({ ...found, bots: RESOLVE_BOT_REVIEWS, head: state.head, owner: OWNER, self: SELF }) : []
  await allSettled(toAsk.map(async review => {
    const posted = await askOnce(pr, state.head, review.login)
    await (posted === null ? Promise.resolve() : report(resolveAskedEvent({ asked: posted, head: state.head, pr, review }), pr))
  }))
}
