/**
 * What a PR's review threads and reviews ask of the watcher (pure, so it is tested): the threads a
 * `Resolved: <reason>` reply asks to resolve (#279), why an approved, green PR still can't merge (#278),
 * and the bot change requests it may dismiss where the repository opts in: on an older commit (#285), or
 * on the head once `Resolved:` replies settled them (#290).
 */
import type { Event } from './watch-events'
import { oneLine } from './watch-text'

/** What `BLOCKED_BY_REVIEW` asks for a bot's change request on the head (#290). */
const SETTLE = 'once its points are dealt with, reply `Resolved: <reason>` in each of its threads (on the PR when it has none), or ask the owner to dismiss it'

export interface ReviewThread {
  /** GraphQL's node id (`PRRT_…`), which `resolveReviewThread` takes. */
  id: string
  resolved: boolean
  /** Who wrote the thread's last comment, in the REST form (`name[bot]`), its text and its link. */
  lastAuthor: string
  lastBody: string
  url: string
  /** The REST id of the review that opened the thread; 0 where it wasn't asked. */
  review: number
}

/** A reply starting `Resolved: <reason>`, with a reason, asks for its thread to be resolved (#279). */
const RESOLVED = /^\s*Resolved:\s*\S/u
const asksToResolve = (thread: ReviewThread) => RESOLVED.test(thread.lastBody)

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
  /** The commit the review was left on, and when (ISO 8601). */
  commit: string
  submittedAt: string
}

/** A comment on the PR itself (not in a review thread). */
export interface PrComment {
  author: string
  body: string
  createdAt: string
  url: string
}

/** A change request the watcher dismisses, with the `Resolved:` replies that settled it (none for one on an older commit). */
export interface Dismissal {
  review: Review
  replies: { body: string, url: string }[]
}

/** Each reviewer's latest review that counts (as in `decisionFrom`) when it requests changes: GitHub counts it until it is dismissed. */
const changeRequests = (reviews: readonly Review[]): Review[] => {
  const latest = new Map<string, Review>()
  for (const review of reviews) {
    if (review.state === 'APPROVED' || review.state === 'CHANGES_REQUESTED' || review.state === 'DISMISSED') {
      latest.set(review.login, review)
    }
  }
  return [...latest.values()].filter(review => review.state === 'CHANGES_REQUESTED')
}

const isBot = (login: string) => login.endsWith('[bot]')

const after = (later: string, earlier: string) =>
  later !== '' && earlier !== '' && Temporal.Instant.compare(Temporal.Instant.from(later), Temporal.Instant.from(earlier)) > 0

/**
 * The `Resolved: <reason>` replies that settle a change request on the head (#290), or null while it
 * isn't settled: the last comment of each of its threads, or, when it has none (an outside-diff or
 * summary-only review), the newest `Resolved:` reply on the PR since the review. Only `settlers`' replies count (the
 * agent, the owner), and only replies after the review: when the bot reviews again, its new review
 * needs its own.
 */
const headReplies = (review: Review, { comments, settlers, threads }: { comments: readonly PrComment[], settlers: ReadonlySet<string>, threads: readonly ReviewThread[] }) => {
  const settles = (author: string, body: string) => settlers.has(author.toLowerCase()) && RESOLVED.test(body)
  const own = threads.filter(thread => thread.review === review.id)
  if (own.length > 0) {
    return own.every(thread => settles(thread.lastAuthor, thread.lastBody)) ? own.map(thread => ({ body: thread.lastBody, url: thread.url })) : null
  }
  const reply = comments.findLast(comment => after(comment.createdAt, review.submittedAt) && settles(comment.author, comment.body))
  return reply ? [{ body: reply.body, url: reply.url }] : null
}

/**
 * The change requests the watcher dismisses where the repository opts in (#285), for a PR the owner
 * approved, and only while no review thread is open unsettled (an open one may hold what it asked for;
 * one with a `Resolved:` reply the watcher resolves) and every thread was read (`complete`). Each from a
 * bot (`…[bot]`) whose latest counting review requests changes on an older commit, or on the head and is
 * settled by `Resolved:` replies (`headReplies`, #290): then that bot's change requests on older
 * commits, and those on the head that are settled themselves, each with its own replies. A person's
 * change request is never dismissed: that stays the owner's call. `settlers` are the logins whose
 * replies count.
 */
export const reviewsToDismiss = ({ comments, complete, head, reviews, settlers, threads }: {
  comments: readonly PrComment[]
  complete: boolean
  head: string
  reviews: readonly Review[]
  settlers: readonly string[]
  threads: readonly ReviewThread[]
}): Dismissal[] => {
  if (!complete || threads.some(thread => !thread.resolved && !asksToResolve(thread))) {
    return []
  }
  const context = { comments, settlers: new Set(settlers.filter(login => login !== '').map(login => login.toLowerCase())), threads }
  const replies = (review: Review) => (review.commit === head ? headReplies(review, context) : [])
  return changeRequests(reviews).filter(latest => isBot(latest.login) && replies(latest) !== null).flatMap(latest =>
    reviews.filter(review => review.login === latest.login && review.state === 'CHANGES_REQUESTED').flatMap(review => {
      const settled = latest.commit === head || review.commit !== head ? replies(review) : null
      return settled === null ? [] : [{ replies: settled, review }]
    }))
}

/** Where a change request was left, as the events and the dismissal say it. */
const where = (review: Review, head: string) => `${review.commit === head ? 'the head' : 'an older commit'} (${review.commit.slice(0, 7)})`

/** The message a dismissal leaves on the review: why, quoting the `Resolved:` replies it relied on (#290). */
export const dismissalMessage = ({ replies }: Dismissal): string => {
  if (replies.length === 0) {
    return 'Dismissed by the project watcher: the owner approved a newer commit, and no review thread is open (DISMISS_STALE_BOT_REVIEWS).'
  }
  const quotes = replies.map(reply => `> ${oneLine(reply.body, 300)}\n> ${reply.url}`)
  return ['Dismissed by the project watcher: the owner approved, and this change request was settled with `Resolved:` replies (DISMISS_STALE_BOT_REVIEWS):', ...quotes].join('\n\n')
}

/** The event for a change request the watcher dismissed, or failed to: reported once per review. */
export const dismissedReviewEvent = ({ dismissal: { replies, review }, dismissed, head, pr }: { dismissal: Dismissal, dismissed: boolean, head: string, pr: number }): Event => {
  const what = `${review.login}'s change request on ${where(review, head)}`
  const why = replies.length === 0 ? 'the owner approved, and no review thread is open' : 'the owner approved, and `Resolved:` replies settled it'
  return dismissed
    ? { key: `pr-${pr} review-dismissed ${review.id}`, lines: [`REVIEW_DISMISSED: dismissed ${what}: ${why}`] }
    : { key: `pr-${pr} review-dismiss-failed ${review.id}`, lines: [`REVIEW_DISMISS_FAILED: couldn't dismiss ${what} (it tries again on every look); check the GH token may write pull requests`] }
}

/**
 * The event for a PR the owner approved, with CI green at `head`, that GitHub still won't merge: each
 * open thread whose last comment is the agent's own (answered, but a ruleset wants it resolved) and
 * doesn't already ask to be resolved (the watcher does that, #279), and
 * each change request still counted (`changeRequests`) the watcher didn't dismiss: on an older commit,
 * or on the head (#290; a bot's there is settled with `Resolved:` replies where `dismiss`, the
 * repository's DISMISS_STALE_BOT_REVIEWS, is on, else left to the owner). Null when neither is
 * the cause. Keyed by what blocks it, so a new cause is reported again.
 */
export const blockedByReviewEvent = ({ dismiss, head, pr, reviews, self, threads }: {
  dismiss: boolean
  head: string
  pr: number
  reviews: readonly Review[]
  self: string
  threads: readonly ReviewThread[]
}): Event | null => {
  const answered = threads.filter(thread => !thread.resolved && !asksToResolve(thread) && self !== '' && thread.lastAuthor === self)
  const stale = changeRequests(reviews)
  if (answered.length === 0 && stale.length === 0) {
    return null
  }
  const causes = [...answered.map(thread => thread.id), ...stale.map(review => `${review.login}@${review.commit}`)].toSorted()
  return {
    key: `pr-${pr} blocked-by-review ${head} ${causes.join(' ')}`,
    lines: [
      `BLOCKED_BY_REVIEW: approved and CI is green at ${head.slice(0, 7)}, but review blocks the merge:`,
      ...answered.map(thread => `  answered, not resolved: ${thread.url} (if settled, reply \`Resolved: <reason>\`)`),
      ...stale.map(review => `  ${review.login} requested changes on ${where(review, head)}: ${dismiss && review.commit === head && isBot(review.login) ? SETTLE : 'ask the owner to dismiss it'}`),
    ],
  }
}
