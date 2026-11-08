/**
 * Takes QUESTION_LABEL off a PR the owner approved, or that merged or closed (#371), where
 * CLEAR_QUESTION_LABEL=1; which PRs is `clearsQuestion` (watch-question-events.ts). It removes it with
 * the `GH` token, and only once GitHub says that token is a bot's: never with the owner's login. A
 * removal another watcher made first (404) is theirs to report; a failed one is reported once per head
 * and tried again with backoff. Only the writer does this (#415), and only it asks who `GH` is; a
 * subscribed watcher hears how it went from `relayWrites`, and holds a merged or closed PR a bounded
 * time for that (#440): ending on the same look would lose the outcome.
 */
import { CLEAR_QUESTION_LABEL, QUESTION_LABEL, clearsQuestion, isBotLogin, questionClearedEvent, questionOutcomeKeys, questionUncheckedEvent } from './watch-question-events'
import { GH, failedStatus } from './watch-gh'
import { type PrState, REPO, gh } from './watch-github'
import { at } from './watch-text'
import { IS_WRITER, attemptWrite, reportWrite, writerRuns } from './watch-writer'
import { reportedLines } from './watch-output'
import { updateLines } from './watch-state'
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

const factsOf = (state: PrState) => ({ approvedCommit: state.ownerApprovalCommit, enabled: CLEAR_QUESTION_LABEL, labelled: state.labels.includes(QUESTION_LABEL), state: state.state })

/** Takes the label off PR `pr` where `clearsQuestion` says so, and reports it. */
export const clearQuestion = async (pr: number, state: PrState): Promise<void> => {
  await (clearsQuestion(factsOf(state)) ? attemptWrite(`question-${pr}`, async () => removeAndReport(pr, state)) : Promise.resolve())
}

/** How long a subscribed watcher holds a finished PR for the writer's outcome: just over the writer's longest quiet pause (PACES.project, 5 min). */
const OUTCOME_WAIT_MS = Temporal.Duration.from({ minutes: 6 }).total('milliseconds')
const WAITS = 'question-waits'

/**
 * When this watcher first held this head of PR `pr`, kept so a restarted watcher doesn't wait all over
 * again; null when it never did and `start` is off.
 */
const heldSince = async ({ head, nowMs, pr, start }: { head: string, nowMs: number, pr: number, start: boolean }): Promise<number | null> => {
  const entry = `${pr} ${head} `
  const held: { since: number | null } = { since: null }
  await updateLines(WAITS, lines => {
    const known = lines.find(line => line.startsWith(entry)) ?? ''
    if (known !== '') {
      held.since = Number(known.slice(entry.length))
      return lines
    }
    held.since = start ? nowMs : null
    return start ? [...lines, `${entry}${nowMs}`] : lines
  })
  return held.since
}

/**
 * Whether a subscribed watcher should stay on a merged or closed PR for the writer's word on the label
 * (#440): while a writer runs, no outcome for this head has been reported, and the bound isn't over.
 * A wait starts only on a PR still labelled, but outlasts the label: the writer takes it off before it
 * leaves its outcome. Past the bound the look goes on: the all-events watcher still reports the outcome.
 */
export const awaitsQuestionOutcome = async (pr: number, state: PrState, nowMs: number): Promise<boolean> => {
  if (IS_WRITER || state.state === 'OPEN' || !await writerRuns()) {
    return false
  }
  const reported = await reportedLines()
  if (questionOutcomeKeys(pr, state.head).some(key => reported.includes(key))) {
    return false
  }
  const since = await heldSince({ head: state.head, nowMs, pr, start: clearsQuestion(factsOf(state)) })
  return since !== null && nowMs - since < OUTCOME_WAIT_MS
}
