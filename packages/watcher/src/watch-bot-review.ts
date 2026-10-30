/**
 * Asks the review bots for a review once per PR, on request (#324): a PR labelled BOT_REVIEW_LABEL
 * gets `@<bot> review` from the watcher for each bot in REVIEW_BOTS that never reviewed it and was never
 * asked, then the label comes off. Reviews are scarce, so never twice for the same PR, also after new
 * pushes: the asks are claimed in files shared by this machine's watchers of the repository, and a
 * `@<bot> review` comment already on the PR (another machine's, or anyone's) counts as asked.
 *
 * Which bots were asked is what READY_TO_MERGE and its reminder wait on (`askedBots` in
 * watch-state.ts); a bot nobody asked holds nothing back, unless its check run on the head shows it
 * reviewing.
 */
import { BOT_REVIEW_LABEL, REVIEW_BOTS, botReviewEvent, notAskingBecause, reviewCommand } from './watch-bot-review-events'
import type { PrComment } from './watch-review-events'
import { type PrState, REPO, gh } from './watch-github'
import { GH, failedStatus } from './watch-gh'
import { askedFile } from './watch-state'
import { claim, unclaim } from './watch-files'
import { allSettled } from './read'
import { report } from './watch-output'
import { comment, reviewBlockers } from './watch-dismiss'

/**
 * Takes BOT_REVIEW_LABEL off PR `pr` with the `GH` token; true once it is gone, also when another
 * watcher was first (404).
 */
const unlabel = async (pr: number): Promise<boolean> =>
  gh(['api', '-X', 'DELETE', `repos/${REPO}/issues/${pr}/labels/${encodeURIComponent(BOT_REVIEW_LABEL)}`], GH, true)
    .then(() => true, (error: unknown) => failedStatus(error) === 404)

type Outcome = { asked: boolean } | { skipped: string } | null

/**
 * Asks `bot` once among this machine's watchers: only the one that claims it first, also after a
 * restart. Null when the bot was asked already by one of them (nothing to report), `skipped` when
 * GitHub shows it reviewed or was asked before (the claim is made then, so it counts as asked), else
 * whether the comment went through. A failed post gives the claim back, to be tried again next look.
 */
const askOnce = async ({ bot, comments, pr, state }: { bot: string, comments: readonly PrComment[], pr: number, state: PrState }): Promise<Outcome> => {
  const why = notAskingBecause({ bot, comments, state: state.bot })
  const claimed = await claim(askedFile(pr, bot)).then(made => (made ? 'claimed' : 'taken'), () => 'failed')
  if (claimed !== 'claimed') {
    return claimed === 'taken' ? null : { asked: false }
  }
  if (why !== null) {
    return { skipped: why }
  }
  const asked = await comment(pr, reviewCommand(bot))
  await (asked ? Promise.resolve() : unclaim(askedFile(pr, bot)))
  return { asked }
}

/**
 * For a PR labelled BOT_REVIEW_LABEL (the caller checks, with REVIEW_BOTS named): asks each bot that
 * wasn't asked yet, reports each ask, skip or failure, and takes the label off once no ask failed.
 * The label stays while one did, so the next look tries again; a lookup that fails asks nothing.
 */
export const askBotReviews = async (pr: number, state: PrState): Promise<void> => {
  const found = await reviewBlockers(pr).catch(() => null)
  if (!found) {
    return
  }
  const outcomes = await Promise.all(REVIEW_BOTS.map(async bot => ({ bot, outcome: await askOnce({ bot, comments: found.comments, pr, state }) })))
  const failed = outcomes.some(({ outcome }) => outcome !== null && 'asked' in outcome && !outcome.asked)
  const unlabelled = !failed && await unlabel(pr)
  await allSettled(outcomes.map(async ({ bot, outcome }) =>
    (outcome === null ? Promise.resolve() : report(botReviewEvent({ bot, outcome, pr, unlabelled }), pr))))
}
