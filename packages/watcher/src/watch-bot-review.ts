/**
 * Asks the review bots for a review once per PR, on request (#324): a PR labelled BOT_REVIEW_LABEL
 * gets `@<bot> review` from the watcher for each bot in REVIEW_BOTS that never reviewed it and was never
 * asked, then the label comes off. Reviews are scarce, so never twice for the same PR, also after new
 * pushes: the asks are claimed in files shared by this machine's watchers of the repository, and a
 * `@<bot> review` comment already on the PR (another machine's, or anyone's) counts as asked.
 *
 * Which bots were asked is what READY_TO_MERGE and its reminder wait on (`askedBots` in
 * watch-state.ts), and the label itself while it is on; a bot nobody asked holds nothing back, unless
 * its check run on the head shows it reviewing. Watchers on different machines share no claims: each
 * sees the other's comment once it is posted, but two asking in the same moment would both post.
 */
import { BOT_REVIEW_LABEL, REVIEW_BOTS, botReviewEvent, notAskingBecause, reviewCommand } from './watch-bot-review-events'
import type { PrComment } from './watch-review-events'
import { type PrState, REPO, gh } from './watch-github'
import { GH, failedStatus } from './watch-gh'
import { askedFile } from './watch-state'
import { claim, unclaim, writeWhole } from './watch-files'
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

type Outcome = { asked: boolean } | { skipped: string } | 'done' | 'pending'

/** How long a claim may stay empty (its watcher asking) before it counts as left behind by a watcher that stopped. */
const PENDING_SECONDS = 600

/**
 * Another watcher's claim: `done` once it asked or skipped; `pending` while it is asking. One left
 * empty for longer than PENDING_SECONDS (its watcher stopped mid-ask) is given back, to be asked
 * again on the next look.
 */
const claimedElsewhere = async (path: string): Promise<'done' | 'pending'> => {
  const file = Bun.file(path)
  if ((await file.text().catch(() => '')).trim() === 'done') {
    return 'done'
  }
  const now = Temporal.Now.instant().epochMilliseconds
  const ageSeconds = (now - await file.stat().then(info => info.mtimeMs, () => now)) / 1000
  await (ageSeconds > PENDING_SECONDS ? unclaim(path) : Promise.resolve())
  return 'pending'
}

/**
 * Asks `bot` once among this machine's watchers: only the one that claims it first, also after a
 * restart. `skipped` when GitHub shows it reviewed or was asked before (the claim is made then, so
 * it counts as asked), `done` or `pending` when another watcher claimed it (nothing to report), else
 * whether the comment went through. A failed post gives the claim back, to be tried again next look.
 */
const askOnce = async ({ bot, comments, pr, state }: { bot: string, comments: readonly PrComment[], pr: number, state: PrState }): Promise<Outcome> => {
  const path = askedFile(pr, bot)
  const claimed = await claim(path).then(made => (made ? 'claimed' : 'taken'), () => 'failed')
  if (claimed !== 'claimed') {
    return claimed === 'taken' ? claimedElsewhere(path) : { asked: false }
  }
  const why = notAskingBecause({ bot, comments, state: state.bot })
  const asked = why === null ? await comment(pr, reviewCommand(bot)) : true
  await (asked ? writeWhole(path, 'done') : unclaim(path))
  return why === null ? { asked } : { skipped: why }
}

/**
 * For a PR labelled BOT_REVIEW_LABEL (the caller checks, with REVIEW_BOTS named): asks each bot that
 * wasn't asked yet, reports each ask, skip or failure, and takes the label off once every bot's ask is
 * done. The label stays while one failed or another watcher is still asking, so the next look tries
 * again (READY_TO_MERGE waits meanwhile); a lookup that fails asks nothing.
 */
export const askBotReviews = async (pr: number, state: PrState): Promise<void> => {
  const found = await reviewBlockers(pr).catch(() => null)
  if (!found) {
    return
  }
  const outcomes = await Promise.all(REVIEW_BOTS.map(async bot => ({ bot, outcome: await askOnce({ bot, comments: found.comments, pr, state }) })))
  const finished = outcomes.every(({ outcome }) => outcome === 'done' || (typeof outcome === 'object' && !('asked' in outcome && !outcome.asked)))
  const unlabelled = finished && await unlabel(pr)
  await allSettled(outcomes.map(async ({ bot, outcome }) =>
    (typeof outcome === 'string' ? Promise.resolve() : report(botReviewEvent({ bot, outcome, pr, unlabelled }), pr))))
}
