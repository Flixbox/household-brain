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
 *
 * Every watcher of the repository looks (#264), so before posting, a watcher claims the ask in a file
 * all of them on this machine share: only the one that created it posts, also after a restart, and a
 * failed post gives the claim back. A watcher on another machine sees the comment instead.
 */
import { RESOLVE_BOT_REVIEWS, bare, botsToAskResolve, resolveAskedEvent, resolveCommand } from './watch-review-events'
import { OWNER, type PrState, REPO } from './watch-github'
import { reviewBlockers } from './watch-dismiss'
import { GH, ghText } from './watch-gh'
import { report } from './watch-output'
import { readLines } from './watch-state'
import { WATCHERS_DIR, claim, removeOlder, unclaim } from './watch-files'
import { allSettled } from './read'

/** Where the asks are claimed: one file per PR, head and bot, shared by this machine's watchers of the repository. */
const CLAIMS_DIR = `${WATCHERS_DIR}/${REPO.replace('/', '_')}/resolve-asked`
// A head asked about weeks ago is long gone: its claim is only taking up room.
await removeOlder(CLAIMS_DIR, Temporal.Duration.from({ hours: 24 * 14 }))

/** Comments `body` on PR `pr` with the `GH` token; false when it couldn't. */
const comment = async (pr: number, body: string): Promise<boolean> =>
  ghText(['pr', 'comment', String(pr), '--repo', REPO, '--body', body], GH, true).then(() => true, () => false)

/**
 * Posts `@<bot> resolve` once among this machine's watchers: null when another one claimed it, else
 * whether the comment went through (a failed one is given back, to be tried again next look). A claim
 * that can't be made counts as a failure: nothing is posted.
 */
const askOnce = async (pr: number, head: string, login: string): Promise<boolean | null> => {
  const path = `${CLAIMS_DIR}/pr-${pr}-${head}-${bare(login)}`
  const claimed = await claim(path).catch(() => undefined)
  if (claimed !== true) {
    return claimed === undefined ? false : null
  }
  const asked = await comment(pr, resolveCommand(login))
  await (asked ? Promise.resolve() : unclaim(path))
  return asked
}

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
    const asked = await askOnce(pr, state.head, review.login)
    await (asked === null ? Promise.resolve() : report(resolveAskedEvent({ asked, head: state.head, pr, review }), pr))
  }))
}
