/**
 * Asking a review bot for its review once per PR, on request (#324), and waiting for it (pure, so it is
 * tested): which bots a PR's label asks, why one isn't asked, what is reported, and whether
 * READY_TO_MERGE waits. The side that writes to GitHub is watch-bot-review.ts.
 */
import type { Event } from './watch-events'
import { type Json, at, record, records } from './watch-text'
import { bare, botNames } from './watch-review-events'
import { textOf } from './read'

// REVIEW_BOTS: the review bots' logins, comma-separated (`coderabbitai` or `coderabbitai[bot]`). A PR
// labelled BOT_REVIEW_LABEL gets `@<bot> review` from the watcher, once (#324), and READY_TO_MERGE and
// its reminder wait for the review asked for, or one in progress. None by default: nothing is asked,
// nothing waits.
export const REVIEW_BOTS = botNames(process.env.REVIEW_BOTS ?? '')

// BOT_REVIEW_LABEL: the label that asks REVIEW_BOTS for a review (#324); `bot-review` by default.
export const BOT_REVIEW_LABEL = process.env.BOT_REVIEW_LABEL ?? 'bot-review'

/** What a PR's comments, reviews and checks say about the review bots: who was asked and who reviewed it (any commit), and whether one is reviewing now. */
export interface BotReviewState {
  /**
   * The named bots someone asked on the PR with a `@<bot> review` comment (the watcher on any machine,
   * or anyone else), in `bare` form, from its last hundred comments (#325).
   */
  asked: string[]
  /** The PR carries BOT_REVIEW_LABEL: a review is asked for and the ask not yet done (#324). */
  requested: boolean
  /** The named bots that left a review on the PR, on any commit, in `bare` form. */
  reviewed: string[]
  /** A named bot's check run on the head is still queued or in progress (CodeRabbit's "CodeRabbit" check). */
  reviewing: boolean
}

export const NO_BOT_REVIEW: BotReviewState = { asked: [], requested: false, reviewed: [], reviewing: false }

/** The comment that asks a bot for its review (#324): CodeRabbit's documented trigger. */
export const reviewCommand = (login: string): string => `@${bare(login)} review`

/**
 * The review bots' state from a PR as GraphQL gives it: its label names, `comments` with their `body`
 * (#325), `reviews` with `author.login`, and the head's check suites with their app's slug (a bot's
 * login without `[bot]`) and check runs (#324).
 */
export const botReviewStateOf = ({ bots, comments, labels, reviews, suites }: { bots: readonly string[], comments: readonly Json[], labels: readonly string[], reviews: readonly Json[], suites: readonly Json[] }): BotReviewState => ({
  asked: bots.filter(bot => comments.some(comment => textOf(comment.body).trim().toLowerCase() === reviewCommand(bot))),
  requested: bots.length > 0 && labels.includes(BOT_REVIEW_LABEL),
  reviewed: [...new Set(reviews.map(review => bare(textOf(record(review.author).login))).filter(login => bots.includes(login)))],
  reviewing: suites.some(suite => bots.includes(bare(textOf(record(suite.app).slug)))
    && records(at(suite, 'checkRuns', 'nodes')).some(run => textOf(run.status) !== 'COMPLETED')),
})

/**
 * Whether PR's READY_TO_MERGE waits for a review bot (#324): its label still asks for a review, one
 * is reviewing it now, or a bot asked for its review hasn't reviewed it yet: one of `asked` (this
 * machine's record of the watcher's asks) or of the state's `asked` (a `@<bot> review` comment on the
 * PR, so a watcher on any machine waits for it, #325). The watcher asks a bot
 * only while it never reviewed the PR, so any review of its after the ask is the one asked for; its
 * approval after `@<bot> resolve` (#303) comes only after an earlier review, so it is never taken for
 * it, and a `resolve` is never an ask. A PR nobody asked a bot about waits for none (unlike #299).
 */
export const awaitsBotReview = ({ asked, state }: { asked: readonly string[], state: BotReviewState }): boolean =>
  state.requested || state.reviewing || [...asked, ...state.asked].some(bot => !state.reviewed.includes(bare(bot)))

/** Why the watcher doesn't ask `bot` (#324): it reviewed the PR already, or someone asked it already (a `@<bot> review` comment); null to ask. */
export const notAskingBecause = ({ bot, state }: { bot: string, state: BotReviewState }): string | null => {
  if (state.reviewed.includes(bare(bot))) {
    return 'it reviewed this PR already'
  }
  return state.asked.includes(bare(bot)) ? 'it was asked already' : null
}

/**
 * What became of BOT_REVIEW_LABEL, which the watcher takes off before it asks (#325): `removed` for
 * good, `restored` after an ask failed (the next look tries again), or `lost` when it couldn't be put back.
 */
export type LabelFate = 'lost' | 'removed' | 'restored'

const LABEL_LINES: Record<LabelFate, string> = {
  lost: `couldn't put the label \`${BOT_REVIEW_LABEL}\` back: add it again to ask again`,
  removed: `removed the label \`${BOT_REVIEW_LABEL}\``,
  restored: `put the label \`${BOT_REVIEW_LABEL}\` back, so the next look tries again`,
}

/** The event for a review the watcher asked `bot` for, failed to ask, or skipped (#324): once per PR and bot. */
export const botReviewEvent = ({ bot, label: fate, outcome, pr }: { bot: string, label: LabelFate, outcome: { asked: boolean } | { skipped: string }, pr: number }): Event => {
  const label = LABEL_LINES[fate]
  const command = `\`${reviewCommand(bot)}\``
  if ('skipped' in outcome) {
    return { key: `pr-${pr} bot-review-skipped ${bare(bot)}`, lines: [`BOT_REVIEW_SKIPPED: didn't ask ${bare(bot)} (${command}): ${outcome.skipped}, and it reviews a PR at most once; ${label}`] }
  }
  return outcome.asked
    ? { key: `pr-${pr} bot-review-asked ${bare(bot)}`, lines: [`BOT_REVIEW_ASKED: asked ${bare(bot)} for its review (${command}), never again for this PR; ${label}. READY_TO_MERGE waits for its review`] }
    : { key: `pr-${pr} bot-review-failed ${bare(bot)}`, lines: [`BOT_REVIEW_FAILED: couldn't post ${command}; ${label}. Check the GH token may comment on pull requests`] }
}
