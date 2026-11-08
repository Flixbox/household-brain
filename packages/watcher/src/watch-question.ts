/**
 * Takes QUESTION_LABEL off a PR the owner approved, or that merged or closed (#371), where
 * CLEAR_QUESTION_LABEL=1; which PRs is `clearsQuestion` (watch-question-events.ts). It removes it with
 * the `GH` token, and only once GitHub says that token is a bot's: never with the owner's login. A
 * removal another watcher made first (404) is theirs to report; a failed one is reported once per head
 * and tried again with backoff. Only the writer does this (#415), and only it asks who `GH` is; a
 * subscribed watcher hears how it went from `relayWrites`.
 */
import { CLEAR_QUESTION_LABEL, QUESTION_LABEL, clearsQuestion, isBotLogin, questionClearedEvent, questionUncheckedEvent } from './watch-question-events'
import { GH, failedStatus } from './watch-gh'
import { type PrState, REPO, gh } from './watch-github'
import { at } from './watch-text'
import { attemptWrite, reportWrite } from './watch-writer'
import { textOf } from './read'

/** Whether `GH` is a bot's token, once GitHub answered. */
const identity: { bot: boolean | null } = { bot: null }

/**
 * Whether `GH` signs in as a bot, by GitHub's `viewer`, asked until it answers; null while it doesn't.
 * Only `true` lets the label come off: it fails closed.
 */
const ghIsBot = async (): Promise<boolean | null> => {
  identity.bot ??= await gh(['api', 'graphql', '-f', 'query={viewer{login}}'], GH, true)
    .then(answer => isBotLogin(textOf(at(answer, 'data', 'viewer', 'login'))), () => null)
  return identity.bot
}

/** `removed`, `gone` (off already), or `failed`. */
const removeLabel = async (pr: number): Promise<'failed' | 'gone' | 'removed'> =>
  gh(['api', '-X', 'DELETE', `repos/${REPO}/issues/${pr}/labels/${encodeURIComponent(QUESTION_LABEL)}`], GH, true)
    .then(() => 'removed' as const, (error: unknown) => (failedStatus(error) === 404 ? 'gone' : 'failed'))

/**
 * The write and its reports. False (it waits) for a failed removal or a viewer that can't be read; a
 * token that is a person's is known without asking again, so that attempt doesn't count (null), like
 * a removal another watcher made first.
 */
const removeAndReport = async (pr: number, state: PrState): Promise<boolean | null> => {
  const bot = await ghIsBot()
  if (bot !== true) {
    await reportWrite(questionUncheckedEvent({ head: state.head, person: bot === false, pr }), pr)
    return bot === null ? false : null
  }
  const outcome = await removeLabel(pr)
  if (outcome === 'gone') {
    return null
  }
  await reportWrite(questionClearedEvent({ approved: state.ownerApprovalCommit, head: state.head, pr, removed: outcome === 'removed', state: state.state }), pr)
  return outcome === 'removed'
}

/** Takes the label off PR `pr` where `clearsQuestion` says so, and reports it. */
export const clearQuestion = async (pr: number, state: PrState): Promise<void> => {
  const facts = { approvedCommit: state.ownerApprovalCommit, enabled: CLEAR_QUESTION_LABEL, labelled: state.labels.includes(QUESTION_LABEL), state: state.state }
  await (clearsQuestion(facts) ? attemptWrite(`question-${pr}`, async () => removeAndReport(pr, state)) : Promise.resolve())
}
