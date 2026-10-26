/** Why an approved, green PR still can't merge, from its review threads and reviews (#278; pure, so it is tested). */
import type { Event } from './watch-events'

export interface ReviewThread {
  /** GraphQL's node id (`PRRT_…`), which `resolveReviewThread` takes. */
  id: string
  resolved: boolean
  /** Who wrote the thread's last comment, in the REST form (`name[bot]`), and its link. */
  lastAuthor: string
  url: string
}

export interface Review {
  login: string
  state: string
  /** The commit the review was left on. */
  commit: string
}

/**
 * The event for a PR the owner approved, with CI green at `head`, that GitHub still won't merge: each
 * open thread whose last comment is the agent's own (answered, but a ruleset wants it resolved), and
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
  const answered = threads.filter(thread => !thread.resolved && self !== '' && thread.lastAuthor === self)
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
      ...answered.map(thread => `  answered, not resolved: ${thread.url}`),
      ...stale.map(review => `  ${review.login} requested changes on an older commit (${review.commit.slice(0, 7)}): ask the owner to dismiss it`),
    ],
  }
}
