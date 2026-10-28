/**
 * Asks a review bot to resolve its settled change request, where the repository opts in (#303): a bot
 * (CodeRabbit) decides on approving only when it reviews a new commit, so once its change request on
 * the head is settled and every thread resolved, it never approves by itself, and a low-risk PR waits
 * for the owner. `@coderabbitai resolve`, a PR comment, makes it resolve its threads and approve, still
 * within its own `max_merge_risk`: the watcher reads no risk rating, the bot decides.
 *
 * RESOLVE_BOT_REVIEWS names the bots to ask; none by default. Only for a PR that isn't a draft, isn't
 * the owner's, isn't approved by the owner (there DISMISS_STALE_BOT_REVIEWS dismisses it instead), and
 * whose CI passed at the head; once per head and bot. The `GH` token must be allowed to comment.
 */
import { RESOLVE_BOT_REVIEWS, botsToAskResolve, resolveAskedEvent, resolveCommand } from './watch-review-events'
import { OWNER, type PrState, REPO } from './watch-github'
import { reviewBlockers } from './watch-dismiss'
import { GH, ghText } from './watch-gh'
import { report } from './watch-output'
import { readLines } from './watch-state'
import { allSettled } from './read'

/** Comments `body` on PR `pr` with the `GH` token; false when it couldn't. */
const comment = async (pr: number, body: string): Promise<boolean> =>
  ghText(['pr', 'comment', String(pr), '--repo', REPO, '--body', body], GH, true).then(() => true, () => false)

/**
 * Asks each bot `botsToAskResolve` names, and reports each, a failure once (it is tried again on every
 * look). The PR's threads and comments are read only once its state shows such a change request, and
 * fresh: another watcher may have asked seconds ago (#264). A lookup that fails asks nothing.
 */
export const askBotsToResolve = async (pr: number, state: PrState): Promise<void> => {
  const reported = await readLines('reported')
  const pending = state.botChangeRequests.filter(bot => !reported.includes(`pr-${pr} bot-resolve-asked ${state.head} ${bot}`))
  const eligible = !state.draft && !state.ownerApproved && state.author.toLowerCase() !== OWNER.toLowerCase()
    && reported.includes(`pr-${pr} ci-passed ${state.head}`)
  if (RESOLVE_BOT_REVIEWS.length === 0 || pending.length === 0 || !eligible) {
    return
  }
  const found = await reviewBlockers(pr, true).catch(() => null)
  const toAsk = found ? botsToAskResolve({ ...found, bots: pending, head: state.head }) : []
  await allSettled(toAsk.map(async review => {
    const asked = await comment(pr, resolveCommand(review.login))
    await report(resolveAskedEvent({ asked, head: state.head, pr, review }), pr)
  }))
}
