/**
 * Asking a review bot for its review once per PR, on request (#324), and waiting for it (pure, so it is
 * tested): which bots a PR's label asks, why one isn't asked, what is reported, and whether
 * READY_TO_MERGE waits. The side that writes to GitHub is watch-bot-review.ts.
 */
import type { Event } from './watch-events'
import { type Json, at, record, records } from './watch-text'
import { type PrComment, bare, botNames } from './watch-review-events'
import { textOf } from './read'

// REVIEW_BOTS: the review bots' logins, comma-separated (`coderabbitai` or `coderabbitai[bot]`). A PR
// labelled BOT_REVIEW_LABEL gets `@<bot> review` from the watcher, once (#324), and READY_TO_MERGE and
// its reminder wait for the review asked for, or one in progress. None by default: nothing is asked,
// nothing waits.
export const REVIEW_BOTS = botNames(process.env.REVIEW_BOTS ?? '')

// BOT_REVIEW_LABEL: the label that asks REVIEW_BOTS for a review (#324); `bot-review` by default.
export const BOT_REVIEW_LABEL = process.env.BOT_REVIEW_LABEL ?? 'bot-review'

/** What a PR's reviews and checks say about the review bots: who reviewed it (any commit), and whether one is reviewing now. */
export interface BotReviewState {
  /** The named bots that left a review on the PR, on any commit, in `bare` form. */
  reviewed: string[]
  /** A named bot's check run on the head is still queued or in progress (CodeRabbit's "CodeRabbit" check). */
  reviewing: boolean
}

export const NO_BOT_REVIEW: BotReviewState = { reviewed: [], reviewing: false }

/**
 * The review bots' state from a PR as GraphQL gives it: `reviews` with `author.login`, and the head's
 * check suites with their app's slug (a bot's login without `[bot]`) and check runs (#324).
 */
export const botReviewStateOf = (bots: readonly string[], reviews: readonly Json[], suites: readonly Json[]): BotReviewState => ({
  reviewed: [...new Set(reviews.map(review => bare(textOf(record(review.author).login))).filter(login => bots.includes(login)))],
  reviewing: suites.some(suite => bots.includes(bare(textOf(record(suite.app).slug)))
    && records(at(suite, 'checkRuns', 'nodes')).some(run => textOf(run.status) !== 'COMPLETED')),
})

/** The comment that asks a bot for its review (#324): CodeRabbit's documented trigger. */
export const reviewCommand = (login: string): string => `@${bare(login)} review`

/**
 * Whether PR's READY_TO_MERGE waits for a review bot (#324): one is reviewing it now, or one of
 * `asked` (the bots the watcher asked, `@<bot> review`) hasn't reviewed it yet. The watcher asks a bot
 * only while it never reviewed the PR, so any review of its after the ask is the one asked for; its
 * approval after `@<bot> resolve` (#303) comes only after an earlier review, so it is never taken for
 * it, and a `resolve` is never an ask. A PR nobody asked a bot about waits for none (unlike #299).
 */
export const awaitsBotReview = ({ asked, state }: { asked: readonly string[], state: BotReviewState }): boolean =>
  state.reviewing || asked.some(bot => !state.reviewed.includes(bare(bot)))

/** Why the watcher doesn't ask `bot` (#324): it reviewed the PR already, or someone asked it already (a `@<bot> review` comment); null to ask. */
export const notAskingBecause = ({ bot, comments, state }: { bot: string, comments: readonly PrComment[], state: BotReviewState }): string | null => {
  if (state.reviewed.includes(bare(bot))) {
    return 'it reviewed this PR already'
  }
  return comments.some(comment => comment.body.trim().toLowerCase() === reviewCommand(bot)) ? 'it was asked already' : null
}

/** The event for a review the watcher asked `bot` for, failed to ask, or skipped (#324): once per PR and bot. */
export const botReviewEvent = ({ bot, outcome, pr, unlabelled }: { bot: string, outcome: { asked: boolean } | { skipped: string }, pr: number, unlabelled: boolean }): Event => {
  const label = unlabelled ? `removed the label \`${BOT_REVIEW_LABEL}\`` : `couldn't remove the label \`${BOT_REVIEW_LABEL}\` yet (it tries again on every look)`
  const command = `\`${reviewCommand(bot)}\``
  if ('skipped' in outcome) {
    return { key: `pr-${pr} bot-review-skipped ${bare(bot)}`, lines: [`BOT_REVIEW_SKIPPED: didn't ask ${bare(bot)} (${command}): ${outcome.skipped}, and it reviews a PR at most once; ${label}`] }
  }
  return outcome.asked
    ? { key: `pr-${pr} bot-review-asked ${bare(bot)}`, lines: [`BOT_REVIEW_ASKED: asked ${bare(bot)} for its review (${command}), never again for this PR; ${label}. READY_TO_MERGE waits for its review`] }
    : { key: `pr-${pr} bot-review-failed ${bare(bot)}`, lines: [`BOT_REVIEW_FAILED: couldn't post ${command} (it tries again on every look); check the GH token may comment on pull requests`] }
}
