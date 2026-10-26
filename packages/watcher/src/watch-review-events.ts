/**
 * What a PR's review threads and reviews ask of the watcher (pure, so it is tested): the threads a
 * `Resolved: <reason>` reply asks to resolve (#279), and why an approved, green PR still can't merge (#278).
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
const RESOLVED_REPLY = /^\s*Resolved:\s*\S/u

/**
 * The open threads whose last comment asks for them to be resolved, whoever wrote it (the agent, the
 * owner, a reviewer: the owner's decision on #279). The watcher resolves them with its own `GH`
 * token, so agents never need the mutation, and the reason stays on record in the thread.
 */
export const threadsToResolve = (threads: readonly ReviewThread[]): ReviewThread[] =>
  threads.filter(thread => !thread.resolved && RESOLVED_REPLY.test(thread.lastBody))

/** The event for a thread the watcher resolved, or failed to: reported once per thread. */
export const resolvedThreadEvent = (pr: number, thread: ReviewThread, resolved: boolean): Event => resolved
  ? { key: `pr-${pr} thread-resolved ${thread.id}`, lines: [`THREAD_RESOLVED: resolved on its \`Resolved:\` reply: ${thread.url}`] }
  : { key: `pr-${pr} thread-resolve-failed ${thread.id}`, lines: [`THREAD_RESOLVE_FAILED: couldn't resolve ${thread.url} (it tries again on every look); check the GH token may write pull requests`] }

export interface Review {
  login: string
  state: string
  /** The commit the review was left on. */
  commit: string
}

/**
 * The event for a PR the owner approved, with CI green at `head`, that GitHub still won't merge: each
 * open thread whose last comment is the agent's own (answered, but a ruleset wants it resolved) and
 * doesn't already ask to be resolved (the watcher does that, #279), and
 * each reviewer whose latest review that counts (as in `decisionFrom`) requests changes on an older
 * commit (GitHub keeps counting it until it is dismissed). Null when neither is the cause. Keyed by
 * what blocks it, so a new cause is reported again.
 */
export const blockedByReviewEvent = ({ head, pr, reviews, self, threads }: {
  head: string
  pr: number
  reviews: readonly Review[]
  self: string
  threads: readonly ReviewThread[]
}): Event | null => {
  const asked = new Set(threadsToResolve(threads))
  const answered = threads.filter(thread => !thread.resolved && !asked.has(thread) && self !== '' && thread.lastAuthor === self)
  const latest = new Map<string, Review>()
  for (const review of reviews) {
    if (review.state === 'APPROVED' || review.state === 'CHANGES_REQUESTED' || review.state === 'DISMISSED') {
      latest.set(review.login, review)
    }
  }
  const stale = [...latest.values()].filter(review => review.state === 'CHANGES_REQUESTED' && review.commit !== head)
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
