/**
 * Asks the review bots for a review once per PR, on request (#324): a PR labelled BOT_REVIEW_LABEL
 * gets `@<bot> review` from the watcher for each bot in REVIEW_BOTS that never reviewed it and was never
 * asked, then the label comes off. Reviews are scarce, so never twice for the same PR, also after new
 * pushes, and also with watchers on several machines (#325): the claim is made on GitHub, by taking
 * the label off before anything is posted. GitHub removes it for one watcher and answers 404 to every
 * other, wherever it runs, so only that one asks. A `@<bot> review` comment already on the PR (another
 * watcher's, or anyone's; `asked` in the PR state) counts as asked, and this machine's asks are
 * recorded in files too: a fast path, and what its watchers wait on before the comment shows.
 *
 * Which bots were asked is what READY_TO_MERGE and its reminder wait on (`awaitsBotReview`): the
 * `@<bot> review` comments, the files (`askedBots` in watch-state.ts), and the label itself while it
 * is on; a bot nobody asked holds nothing back, unless its check run on the head shows it reviewing.
 */
import { BOT_REVIEW_LABEL, type LabelFate, REVIEW_BOTS, botReviewEvent, notAskingBecause, reviewCommand } from './watch-bot-review-events'
import { type PrState, REPO, gh } from './watch-github'
import { GH, failedStatus } from './watch-gh'
import { allSettled, ignoreFailure } from './read'
import { writeWhole } from './watch-files'
import { askedFile } from './watch-state'
import { comment } from './watch-dismiss'
import { report } from './watch-output'

const LABEL_PATH = `repos/${REPO}/issues`

/**
 * Takes BOT_REVIEW_LABEL off PR `pr` with the `GH` token, the claim on its asks (#325): `taken` for the
 * one watcher whose removal went through, `gone` when the label was off already (another watcher, on
 * any machine, took it and asks), `failed` otherwise (the next look tries again).
 */
const takeLabel = async (pr: number): Promise<'failed' | 'gone' | 'taken'> =>
  gh(['api', '-X', 'DELETE', `${LABEL_PATH}/${pr}/labels/${encodeURIComponent(BOT_REVIEW_LABEL)}`], GH, true)
    .then(() => 'taken' as const, (error: unknown) => (failedStatus(error) === 404 ? 'gone' : 'failed'))

/** Puts BOT_REVIEW_LABEL back on PR `pr` after an ask failed, so the next look, on any machine, tries again; true once it is on. */
const putLabelBack = async (pr: number): Promise<boolean> =>
  gh(['api', '-X', 'POST', `${LABEL_PATH}/${pr}/labels`, '-f', `labels[]=${BOT_REVIEW_LABEL}`], GH, true).then(() => true, () => false)

/**
 * Records that `bot` was asked about PR `pr` (or that it needn't be), for good. A record that can't be
 * written loses nothing: the `@<bot> review` comment on GitHub says the same to every watcher.
 */
const remember = async (pr: number, bot: string): Promise<void> => writeWhole(askedFile(pr, bot), 'done').catch(ignoreFailure)

type Outcome = { asked: boolean } | { skipped: string } | 'done'

/**
 * Asks `bot`, by the watcher holding the claim: `done` when this machine's record says it was asked
 * (nothing to report), `skipped` when GitHub shows it reviewed or was asked before (recorded then, so
 * this machine counts it as asked), else whether the comment went through.
 */
const askOnce = async ({ bot, pr, state }: { bot: string, pr: number, state: PrState }): Promise<Outcome> => {
  if (await Bun.file(askedFile(pr, bot)).exists()) {
    return 'done'
  }
  const why = notAskingBecause({ bot, state: state.bot })
  const asked = why === null ? await comment(pr, reviewCommand(bot)) : true
  await (asked ? remember(pr, bot) : Promise.resolve())
  return why === null ? { asked } : { skipped: why }
}

/**
 * For a PR labelled BOT_REVIEW_LABEL (the caller checks, with REVIEW_BOTS named): claims the asks by
 * taking the label off, then asks each bot that wasn't asked yet and reports each ask, skip or
 * failure. A failed ask puts the label back, so the next look tries again (READY_TO_MERGE waits
 * meanwhile); a watcher whose claim didn't go through asks nothing.
 */
export const askBotReviews = async (pr: number, state: PrState): Promise<void> => {
  if (await takeLabel(pr) !== 'taken') {
    return
  }
  const outcomes = await Promise.all(REVIEW_BOTS.map(async bot => ({ bot, outcome: await askOnce({ bot, pr, state }) })))
  const failed = outcomes.some(({ outcome }) => typeof outcome === 'object' && 'asked' in outcome && !outcome.asked)
  const restored = failed && await putLabelBack(pr)
  const label: LabelFate = failed ? (restored ? 'restored' : 'lost') : 'removed'
  await allSettled(outcomes.map(async ({ bot, outcome }) =>
    (typeof outcome === 'string' ? Promise.resolve() : report(botReviewEvent({ bot, label, outcome, pr }), pr))))
}
