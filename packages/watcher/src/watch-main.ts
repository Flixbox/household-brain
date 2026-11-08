/* oxlint-disable import/max-dependencies -- this file is where the watcher's parts meet; pacing adds one */
/* oxlint-disable eslint/no-await-in-loop -- each poller's looks run one after another, on purpose */
/** The project watcher's looks, started by watch-project.ts once it has read which code it runs (#265). */
import { type Activity, mainRunEvent, queueCommand } from './watch-events'
import { type PrState, REPO, mainAhead, mainHead, newestMainRun, prStates } from './watch-github'
import { checkRun } from './watch-ci-runs'
import { APPROVED_DRAFT_NOTE, checkApproval, checkWriter, resolveAsked } from './watch-approval'
import { FOLLOW, checkCode, finishSubscriptions, flush, queue, quiet, report, reportLookups, reportUsage } from './watch-output'
import { addLine, endPr, readLines, start, startSubscriptions, subscriptions, updateLines, writeLines } from './watch-state'
import { activitiesOf, changedActivities, changedStates, checkActivity as checkPrActivity, checkTrackedActivity, watchedPrs } from './watch-activity'
import { checkQueue, preparePr } from './watch-queue'
import { checkIssueStates, checkIssues, checkSubscribedIssues } from './watch-issues'
import { allSettled, hasText, ignoreFailure } from './read'
import { nextPauseMs, setLimitsOwner } from './watch-pace'

const [limitMinutes = '20', maxHours = '12'] = process.argv.slice(2).filter(arg => arg !== '--follow')
if (!/^\d+$/u.test(limitMinutes) || !/^\d+$/u.test(maxHours)) {
  process.stderr.write('ci-limit-minutes and max-hours must be whole numbers\n')
  process.exit(64)
}
const LIMIT_SECONDS = Number(limitMinutes) * 60
const round = { complete: true }
/** Read through a function: the checks of a round reset `round.complete`, which TypeScript can't see. */
const roundComplete = () => round.complete

const short = (sha: string) => sha.slice(0, 7)

const inOrder = async <Item>(items: readonly Item[], each: (item: Item) => Promise<unknown>): Promise<void> =>
  items.reduce<Promise<void>>(async (previous, item) => {
    await previous
    await each(item)
  }, Promise.resolve())

/** A PR's new comments and reviews; a PR whose comments couldn't be read leaves the round incomplete. */
const checkActivity = async (pr: number, items: Activity[] | undefined): Promise<boolean> => {
  const read = await checkPrActivity(pr, items)
  round.complete &&= read
  return read
}

const checkMain = async (): Promise<void> => {
  const newest = await newestMainRun().catch(() => null)
  await report(newest && mainRunEvent({ limitSeconds: LIMIT_SECONDS, repo: REPO, run: newest.run }))
}

/** A new commit on main, so it never moves on unnoticed. The one it was at on the first run isn't news. */
const checkMainHead = async (): Promise<void> => {
  const head = await mainHead().catch(() => null)
  if (!hasText(head?.sha)) {
    return
  }
  const [known] = await readLines('main')
  await writeLines('main', [head.sha])
  const moved = Boolean(known) && known !== head.sha
  await report(moved ? { key: `main-head ${head.sha}`, lines: [`MAIN_ADVANCED: main is at ${short(head.sha)}: ${head.subject}`] } : null)
}

/** Main has commits the PR's branch doesn't; asked only for a PR this look found open (a merged one's commit is its own merge). */
const checkMoved = async (pr: number, head: string): Promise<void> => {
  const { ahead, newest } = await mainAhead(head).catch(() => ({ ahead: 0, newest: '-' }))
  // The PR's state was read at the start of the look. One that merged since counts as open, and its
  // own merge is then a commit main has (#249): ask GitHub again, not for an answer shared seconds
  // ago (#264), and say nothing unless it is still open. A failed read says nothing either: the next
  // look asks again.
  // Asked only while it is news: a branch left behind main isn't asked about on every look.
  const key = `pr-${pr} main-moved ${newest}`
  const news = ahead > 0 && !(await readLines('reported')).includes(key)
  const stillOpen = news && await prStates([pr], true).then(states => states.get(pr)?.state === 'OPEN', () => false)
  await report(stillOpen ? { key, lines: [`MAIN_MOVED: main is ${ahead} commit(s) ahead of the branch: rebase on main and run the checks again`], quiet: true } : null, pr)
}

const untrack = async (pr: number) => updateLines('tracked', lines => lines.filter(line => line !== String(pr)))
const tracked = async (pr: number) => (await readLines('tracked')).includes(String(pr))

/** Terminal activity is fresh: a shared answer from before the merge must not hide a final comment. */
const terminalActivity = async (pr: number, items: Activity[] | undefined) => subscriptions.scoped
  ? (await activitiesOf([pr], true).catch(() => new Map<number, Activity[]>())).get(pr) : items

/** A merged PR: its comments while followed (#129), then its deploy until that is reported. */
const checkMerged = async (pr: number, mergeSha: string, items: Activity[] | undefined): Promise<void> => {
  if ((subscriptions.scoped || await tracked(pr)) && !await checkActivity(pr, await terminalActivity(pr, items))) {
    return
  }
  if (subscriptions.scoped) {
    await report({ key: `pr-${pr} merged ${mergeSha}`, lines: [`MERGED: ${short(mergeSha)}; subscription completed`] }, pr)
    await endPr(pr)
    await untrack(pr)
    return
  }
  const deployed = (await readLines('reported')).some(line => line.startsWith(`pr-${pr} deployed `))
  await (deployed ? untrack(pr) : checkRun({ label: 'deploy', limitSeconds: LIMIT_SECONDS, pr, sha: mergeSha }))
}

const checkClosed = async (pr: number, items: Activity[] | undefined): Promise<void> => {
  if ((subscriptions.scoped || await tracked(pr)) && !await checkActivity(pr, await terminalActivity(pr, items))) {
    return
  }
  await untrack(pr)
  await report({ key: `pr-${pr} closed`, lines: ['CLOSED without merging'] }, pr)
  await endPr(pr)
}

/** Conflicts and approvals, which a parked PR (left open on purpose) doesn't report. */
const checkReview = async (pr: number, state: PrState): Promise<void> => {
  await report(state.mergeable === 'CONFLICTING' ? { key: `pr-${pr} conflict ${state.head}`, lines: [`CONFLICT at ${short(state.head)}: rebase on main`] } : null, pr)
  // Already in the merge queue, there is no auto-merge to enable (#251).
  const queueIt = `queue it, alone in its own call: ${queueCommand(REPO, pr)}`
  const after = state.queued ? 'It is in the merge queue already.' : `Once it is well reviewed, ${queueIt}`
  const next = state.draft ? `${APPROVED_DRAFT_NOTE} Then, once it is well reviewed, ${queueIt}` : after
  await report(state.decision === 'APPROVED' ? { key: `pr-${pr} approved`, lines: [`APPROVED by the owner. ${next}`] } : null, pr)
}

const checkOpen = async (pr: number, state: PrState, items: Activity[] | undefined): Promise<void> => {
  await addLine('tracked', String(pr))
  await report({ key: `pr-${pr} opened`, lines: [`NEW_PR: ${state.title}`] }, pr)
  // Comments before the approval: an approval often comes with review comments, and reporting it
  // first meant auto-merge went on before they were read (#152). While the comments can't be read,
  // the approval waits too.
  const commentsRead = await checkActivity(pr, items)
  // A PR labelled `parked` is left open on purpose: only its CI and comments are news.
  const reviewNews = commentsRead && !state.parked
  // Before the merge checks, so a thread resolved now no longer blocks the merge.
  await resolveAsked(pr, state)
  await (reviewNews ? checkReview(pr, state) : Promise.resolve())
  await checkRun({ label: 'pr', limitSeconds: LIMIT_SECONDS, pr, sha: state.head })
  await (reviewNews ? checkApproval(pr, state).then(async () => { if (!subscriptions.scoped) { await checkMoved(pr, state.head) } }) : Promise.resolve())
}

const checkPr = async (pr: number, state: PrState | undefined, items: Activity[] | undefined): Promise<void> => {
  if (!state) {
    round.complete = false
    return
  }
  if (!await preparePr(pr, state)) { return }
  if (state.state === 'MERGED') {
    await checkMerged(pr, state.mergeSha, items)
    return
  }
  await (state.state === 'CLOSED' ? checkClosed(pr, items) : checkOpen(pr, state, items))
}

const checkPrs = async (): Promise<void> => {
  // A round with a failed listing is skipped rather than run with pull requests missing.
  const prs = await watchedPrs()
  if (!prs) {
    return
  }
  const [states, activities] = await Promise.all([changedStates(prs), changedActivities(prs)])
  round.complete = true
  // All at once (#240): a slow PR holds back only its own events; GH_PARALLEL caps the calls.
  await allSettled(prs.map(async pr => checkPr(pr, states.get(pr), activities.get(pr))))
  // From here on, a PR seen for the first time is a new one. Only after a round in which every PR
  // answered: one that failed must still get its comments recorded.
  await (roundComplete() ? writeLines('initialized', []) : Promise.resolve())
}

type Check = () => Promise<unknown>

/** What someone waits for an answer to: issues, the owner's comments on them and on the PRs followed. */
const ANSWER_CHECKS: Check[] = [checkIssues, checkIssueStates, checkTrackedActivity]
/** The rest: the watcher's own code, main, the merge queue, each PR's CI, reviews and deploy, and whether a writer runs. */
// PR relationships precede queue events, so first-look issue subscriptions route their closing PRs.
const PROJECT_CHECKS: Check[] = [checkCode, checkMain, checkMainHead, checkPrs, checkQueue, checkSubscribedIssues, checkWriter]

interface Poller {
  checks: readonly Check[]
  /** Whether this poller prints the IDLE heartbeat: only one does, or both would. */
  heartbeat: boolean
  pauseSeconds: number
  /** The longest pause that quiet looks grow to, before any rate-limit stretch; the owner's comments keep it short. */
  quietCapSeconds: number
}

/** One look; true when it printed events, so the next look comes after only a short gap (#400). */
const lookOnce = async ({ checks, heartbeat }: Poller): Promise<boolean> => {
  await inOrder(checks, async check => check())
  const busy = await flush()
  finishSubscriptions()
  if (busy) { return true }
  // After a heartbeat the next look waits like after an empty round.
  if (heartbeat && Temporal.Instant.compare(Temporal.Now.instant(), quiet.since.add({ hours: Number(maxHours) })) > 0) {
    queue([`IDLE: nothing happened for ${maxHours} h`], { quiet: true })
    await flush()
  }
  return false
}

/**
 * A look that fails (a state file still locked after its retries, #231) is reported as an event, and
 * the watcher goes on with the next look instead of stopping: events would otherwise end unnoticed.
 */
const lookSafely = async (poller: Poller): Promise<boolean> => lookOnce(poller).catch(async (error: unknown) => {
  queue([`WATCHER_ERROR: ${error instanceof Error ? error.message : 'the look failed'}; still watching`], { system: true })
  await flush()
  return false
})

/** Looks again and again, paced by what it found and by GitHub's rate limit (watch-pace.ts, #400). */
const poll = async (poller: Poller): Promise<never> => {
  // A loop rather than a function awaiting itself: following, the watcher runs for a whole session.
  for (;;) {
    const busy = await lookSafely(poller)
    // After every look of one poller, whatever it found (#253). If the line can't be printed, the
    // next look tries again.
    await (poller.heartbeat ? reportLookups().catch(ignoreFailure) : Promise.resolve())
    // A failed read or write leaves the line for the next look.
    await (poller.heartbeat ? reportUsage().catch(ignoreFailure) : Promise.resolve())
    await Bun.sleep(await nextPauseMs(poller, busy))
  }
}

setLimitsOwner(REPO)
await start()
await startSubscriptions()
finishSubscriptions()
// Following, two pollers run side by side (#240): the answers from every 30 s, never waiting for a slow
// look at CI and deploys. Without `--follow`, one look at everything, the answers first (#235).
await (FOLLOW
  ? Promise.all([poll({ checks: ANSWER_CHECKS, heartbeat: false, pauseSeconds: 30, quietCapSeconds: 60 }), poll({ checks: PROJECT_CHECKS, heartbeat: true, pauseSeconds: 60, quietCapSeconds: 300 })])
  : poll({ checks: [...ANSWER_CHECKS, ...PROJECT_CHECKS], heartbeat: true, pauseSeconds: 60, quietCapSeconds: 300 }))
