/**
 * What a PR's review threads and reviews ask of the watcher (pure, so it is tested): the threads a
 * `Resolved: <reason>` reply asks to resolve (#279), why an approved, green PR still can't merge (#278),
 * and the stale bot change requests it may dismiss where the repository opts in (#285).
 */
import type { Event } from './watch-events'

export interface ReviewThread {
  /** GraphQL's node id (`PRRT_…`), which `resolveReviewThread` takes. */
  id: string
  resolved: boolean
  /** Who wrote the thread's last comment, in the REST form (`name[bot]`), its text and its link. */
  lastAuthor: string
  lastBody: string
  url: string
}

/** A reply starting `Resolved: <reason>`, with a reason, asks for its thread to be resolved (#279). */
const asksToResolve = (thread: ReviewThread) => /^\s*Resolved:\s*\S/u.test(thread.lastBody)

/**
 * The open threads whose last comment asks for them to be resolved, whoever wrote it (the agent, the
 * owner, a reviewer: the owner's decision on #279). The watcher resolves them with its own `GH`
 * token, so agents never need the mutation, and the reason stays on record in the thread.
 */
export const threadsToResolve = (threads: readonly ReviewThread[]): ReviewThread[] =>
  threads.filter(thread => !thread.resolved && asksToResolve(thread))

/** The event for a thread the watcher resolved, or failed to: reported once per thread. */
export const resolvedThreadEvent = (pr: number, thread: ReviewThread, resolved: boolean): Event => resolved
  ? { key: `pr-${pr} thread-resolved ${thread.id}`, lines: [`THREAD_RESOLVED: resolved on its \`Resolved:\` reply: ${thread.url}`] }
  : { key: `pr-${pr} thread-resolve-failed ${thread.id}`, lines: [`THREAD_RESOLVE_FAILED: couldn't resolve ${thread.url} (it tries again on every look); check the GH token may write pull requests`] }

export interface Review {
  /** The REST id (GraphQL's `databaseId`), which a dismissal takes. */
  id: number
  login: string
  state: string
  /** The commit the review was left on. */
  commit: string
}

/**
 * Each reviewer's latest review that counts (as in `decisionFrom`) when it requests changes on a
 * commit older than `head`: GitHub keeps counting it until it is dismissed.
 */
const staleChangeRequests = (head: string, reviews: readonly Review[]): Review[] => {
  const latest = new Map<string, Review>()
  for (const review of reviews) {
    if (review.state === 'APPROVED' || review.state === 'CHANGES_REQUESTED' || review.state === 'DISMISSED') {
      latest.set(review.login, review)
    }
  }
  return [...latest.values()].filter(review => review.state === 'CHANGES_REQUESTED' && review.commit !== head)
}

/**
 * The change requests the watcher dismisses where the repository opts in (#285), for a PR the owner
 * approved: every change request on an older commit from a bot (`…[bot]`) whose latest counting review
 * is such a stale one, and only while no review thread is open (an open one may hold what it asked for).
 * A person's change request is never dismissed: that stays the owner's call.
 */
export const reviewsToDismiss = ({ head, reviews, threads }: { head: string, reviews: readonly Review[], threads: readonly ReviewThread[] }): Review[] => {
  if (threads.some(thread => !thread.resolved)) {
    return []
  }
  const bots = new Set(staleChangeRequests(head, reviews).map(review => review.login).filter(login => login.endsWith('[bot]')))
  return reviews.filter(review => bots.has(review.login) && review.state === 'CHANGES_REQUESTED' && review.commit !== head)
}

/** The event for a change request the watcher dismissed, or failed to: reported once per review. */
export const dismissedReviewEvent = (pr: number, review: Review, dismissed: boolean): Event => {
  const what = `${review.login}'s change request on an older commit (${review.commit.slice(0, 7)})`
  return dismissed
    ? { key: `pr-${pr} review-dismissed ${review.id}`, lines: [`REVIEW_DISMISSED: dismissed ${what}: the owner approved, and no review thread is open`] }
    : { key: `pr-${pr} review-dismiss-failed ${review.id}`, lines: [`REVIEW_DISMISS_FAILED: couldn't dismiss ${what} (it tries again on every look); check the GH token may write pull requests`] }
}

/**
 * The event for a PR the owner approved, with CI green at `head`, that GitHub still won't merge: each
 * open thread whose last comment is the agent's own (answered, but a ruleset wants it resolved) and
 * doesn't already ask to be resolved (the watcher does that, #279), and
 * each stale change request (`staleChangeRequests`) the watcher didn't dismiss. Null when neither is
 * the cause. Keyed by what blocks it, so a new cause is reported again.
 */
export const blockedByReviewEvent = ({ head, pr, reviews, self, threads }: {
  head: string
  pr: number
  reviews: readonly Review[]
  self: string
  threads: readonly ReviewThread[]
}): Event | null => {
  const answered = threads.filter(thread => !thread.resolved && !asksToResolve(thread) && self !== '' && thread.lastAuthor === self)
  const stale = staleChangeRequests(head, reviews)
  if (answered.length === 0 && stale.length === 0) {
    return null
  }
  const causes = [...answered.map(thread => thread.id), ...stale.map(review => `${review.login}@${review.commit}`)].toSorted()
  return {
    key: `pr-${pr} blocked-by-review ${head} ${causes.join(' ')}`,
    lines: [
      `BLOCKED_BY_REVIEW: approved and CI is green at ${head.slice(0, 7)}, but review blocks the merge:`,
      ...answered.map(thread => `  answered, not resolved: ${thread.url} (if settled, reply \`Resolved: <reason>\`)`),
      ...stale.map(review => `  ${review.login} requested changes on an older commit (${review.commit.slice(0, 7)}): ask the owner to dismiss it`),
    ],
  }
}
