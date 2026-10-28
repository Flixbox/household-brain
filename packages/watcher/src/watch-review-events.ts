/**
 * What a PR's review threads and reviews ask of the watcher (pure, so it is tested): the threads a
 * `Resolved: <reason>` reply asks to resolve (#279), why an approved, green PR still can't merge (#278),
 * the bot change requests it may dismiss where the repository opts in: on an older commit (#285), or
 * on the head once `Resolved:` replies settled them (#290), and what an approval asks for (#298): for
 * a PR approved as a draft, a review bot's review of its head first, where REVIEW_BOTS names bots (#299),
 * and which bots to ask with `@<bot> resolve` where RESOLVE_BOT_REVIEWS names them (#303).
 */
import type { Event } from './watch-events'
import { type Json, oneLine, record } from './watch-text'
import { textOf } from './read'

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

/** Who has a say on a bot's change request: the agent (`self`) and the owner, in lower case; an empty login is no one. */
interface Settlers { owner: string, self: string }
const settlersOf = ({ owner, self }: { owner: string, self: string }): Settlers => ({ owner: owner.toLowerCase(), self: self.toLowerCase() })
const settles = ({ owner, self }: Settlers, author: string, body: string) =>
  author !== '' && (author.toLowerCase() === owner || author.toLowerCase() === self) && RESOLVED.test(body)

/**
 * The last word on the PR about a change request without threads, since the review: the newest
 * comment that settles it (a `Resolved:` reply by the agent or the owner) or takes it back (any other
 * comment of the owner's, e.g. "not settled yet", #294). The agent's other comments (rebase notes,
 * summaries) count for neither. Undefined when there is none.
 */
const lastWord = (review: Review, comments: readonly PrComment[], settlers: Settlers) => comments.findLast(comment =>
  after(comment.createdAt, review.submittedAt)
  && (settles(settlers, comment.author, comment.body) || (settlers.owner !== '' && comment.author.toLowerCase() === settlers.owner)))

/** Whether the owner took back a change request without threads with a later comment (#294). */
const takenBack = (review: Review, comments: readonly PrComment[], settlers: Settlers) => {
  const word = lastWord(review, comments, settlers)
  return word !== undefined && !settles(settlers, word.author, word.body)
}

/**
 * The `Resolved: <reason>` replies that settle a change request on the head (#290), or null while it
 * isn't settled: the last comment of each of its threads, or, when it has none (an outside-diff or
 * summary-only review), the `lastWord` on the PR when that is a `Resolved:` reply. Only the agent's and
 * the owner's replies count, and only replies after the review: when the bot reviews again, its new
 * review needs its own.
 */
const headReplies = (review: Review, { comments, settlers, threads }: { comments: readonly PrComment[], settlers: Settlers, threads: readonly ReviewThread[] }) => {
  const own = threads.filter(thread => thread.review === review.id)
  if (own.length > 0) {
    return own.every(thread => settles(settlers, thread.lastAuthor, thread.lastBody)) ? own.map(thread => ({ body: thread.lastBody, url: thread.url })) : null
  }
  const reply = lastWord(review, comments, settlers)
  return reply && settles(settlers, reply.author, reply.body) ? [{ body: reply.body, url: reply.url }] : null
}

/**
 * The change requests the watcher dismisses where the repository opts in (#285), for a PR the owner
 * approved, and only while no review thread is open unsettled (an open one may hold what it asked for;
 * one with a `Resolved:` reply the watcher resolves) and every thread was read (`complete`). Each from a
 * bot (`…[bot]`) whose latest counting review requests changes on an older commit, or on the head and is
 * settled by `Resolved:` replies (`headReplies`, #290): then that bot's change requests on older
 * commits, and those on the head that are settled themselves, each with its own replies. A person's
 * change request is never dismissed: that stays the owner's call. `owner` and `self` (the agent) are
 * the logins whose replies count.
 */
export const reviewsToDismiss = ({ comments, complete, head, owner, reviews, self, threads }: {
  comments: readonly PrComment[]
  complete: boolean
  head: string
  owner: string
  reviews: readonly Review[]
  self: string
  threads: readonly ReviewThread[]
}): Dismissal[] => {
  if (!complete || threads.some(thread => !thread.resolved && !asksToResolve(thread))) {
    return []
  }
  const context = { comments, settlers: settlersOf({ owner, self }), threads }
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

/**
 * What an approved PR (`OWNER`'s decision) with auto-merge off asks for. With CI green at `head`, it
 * is READY_TO_MERGE with `merge`, the command that enables auto-merge. A draft is APPROVED_DRAFT
 * instead (#298), whatever CI says: it can't be queued and a review bot skips drafts, so it is marked
 * ready (`ready`, the command) first; marking drafts ready stays the agent's step. Once per head.
 * Ready again at a head that was an approved draft (`wasDraft`), READY_TO_MERGE says to settle the
 * review bot's threads first (where REVIEW_BOTS names bots, it comes only once one has reviewed, #299).
 */
export const approvedEvent = ({ draft, green, head, merge, pr, ready, wasDraft }: { draft: boolean, green: boolean, head: string, merge: string, pr: number, ready: string, wasDraft: boolean }): Event | null => {
  if (draft) {
    return { key: `pr-${pr} approved-draft ${head}`, lines: [`APPROVED_DRAFT: approved by the owner but still a draft: mark it ready (${ready}), wait for the bot review, then queue`] }
  }
  const when = wasDraft ? 'Once a review bot has reviewed this head and its threads are settled, enable it' : 'Enable it'
  return green ? { key: `pr-${pr} ready ${head}`, lines: [`READY_TO_MERGE: approved and CI is green at ${head.slice(0, 7)}, but auto-merge is off. ${when}: ${merge}`] } : null
}

/** A login as GraphQL and `gh` give it, in lower case: a bot without its REST suffix `[bot]`. */
export const bare = (login: string): string => login.trim().toLowerCase().replace(/\[bot\]$/u, '')

/** The logins in a comma-separated setting, in `bare` form. */
export const botNames = (setting: string): string[] => setting.split(',').map(name => bare(name)).filter(name => name !== '')

// REVIEW_BOTS: the review bots' logins, comma-separated (`coderabbitai` or `coderabbitai[bot]`). A PR
// approved as a draft waits for one of them to review its head before READY_TO_MERGE and its
// reminder. None by default: nothing waits.
export const REVIEW_BOTS = botNames(process.env.REVIEW_BOTS ?? '')

/** Whether one of `bots` reviewed commit `head`; `reviews` as GitHub gives them, with `author.login` and `commit.oid`. */
export const botReviewed = (bots: readonly string[], reviews: readonly Json[], head: string): boolean =>
  reviews.some(review => bots.includes(bare(textOf(record(review.author).login))) && textOf(record(review.commit).oid) === head)

/**
 * Whether PR `pr` waits for a bot's review: bots are named, it was approved as a draft (APPROVED_DRAFT
 * reported at any head, so a push after marking it ready still waits), and no bot reviewed its head.
 */
export const awaitsBotReview = ({ bots, pr, reported, reviewed }: { bots: readonly string[], pr: number, reported: readonly string[], reviewed: boolean }): boolean =>
  bots.length > 0 && !reviewed && reported.some(line => line.startsWith(`pr-${pr} approved-draft `))

// RESOLVE_BOT_REVIEWS: the review bots to ask with `@<bot> resolve` (#303), comma-separated
// (`coderabbitai` or `coderabbitai[bot]`). None by default: the watcher asks none.
export const RESOLVE_BOT_REVIEWS = botNames(process.env.RESOLVE_BOT_REVIEWS ?? '')

/** The comment that asks a bot to resolve its threads and approve (#303): CodeRabbit's documented trigger. */
export const resolveCommand = (login: string): string => `@${bare(login)} resolve`

/**
 * The bots' change requests on `head` the watcher asks to resolve with `@<bot> resolve` (#303), once
 * every review thread is resolved and every thread was read (`complete`). Not one already asked for:
 * a PR comment saying the command after the review (by anyone, another watcher too) settles it. Nor
 * one without threads that the owner took back with a later comment (`takenBack`, #294) until a
 * `Resolved:` reply of the agent's or the owner's follows. Whether the bot then approves is the bot's
 * call (CodeRabbit's `max_merge_risk`); the watcher reads no risk rating. The caller checks the rest:
 * CI green, not a draft, not approved by the owner nor theirs.
 */
export const botsToAskResolve = ({ bots, comments, complete, head, owner, reviews, self, threads }: {
  bots: readonly string[]
  comments: readonly PrComment[]
  complete: boolean
  head: string
  owner: string
  reviews: readonly Review[]
  self: string
  threads: readonly ReviewThread[]
}): Review[] => {
  if (bots.length === 0 || !complete || threads.some(thread => !thread.resolved)) {
    return []
  }
  const asked = (review: Review) => comments.some(comment =>
    after(comment.createdAt, review.submittedAt) && comment.body.trim().toLowerCase() === resolveCommand(review.login))
  const settlers = settlersOf({ owner, self })
  const notTakenBack = (review: Review) => threads.some(thread => thread.review === review.id) || !takenBack(review, comments, settlers)
  return changeRequests(reviews).filter(review => review.commit === head && bots.includes(bare(review.login)) && !asked(review) && notTakenBack(review))
}

/** The event for a bot the watcher asked to resolve its change request on `head`, or failed to: reported once per head and bot. */
export const resolveAskedEvent = ({ asked, head, pr, review }: { asked: boolean, head: string, pr: number, review: Review }): Event => {
  const what = `${bare(review.login)} (\`${resolveCommand(review.login)}\`) for its change request on ${where(review, head)}`
  return asked
    ? { key: `pr-${pr} bot-resolve-asked ${head} ${bare(review.login)}`, lines: [`BOT_RESOLVE_ASKED: asked ${what}: every review thread is resolved and CI is green`] }
    : { key: `pr-${pr} bot-resolve-failed ${head} ${bare(review.login)}`, lines: [`BOT_RESOLVE_FAILED: couldn't ask ${what} (it tries again on every look); check the GH token may write pull requests`] }
}
