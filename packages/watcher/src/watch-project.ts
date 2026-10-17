/* oxlint-disable eslint/no-await-in-loop -- each poller's looks run one after another, on purpose */
/**
 * Watches the whole project until something needs attention, then prints every event pending, the
 * ones someone waits for an answer to (ACTIVITY, APPROVED, …, new issues and comments) first (#222).
 * Each event starts with when it was found, and for a comment or issue when it was written
 * (`[12:27:03, written 12:09:20] ISSUE_COMMENT …`, #240); a comment or review under ACTIVITY names
 * when it was written after its author:
 *
 *   PR #<n>: NEW_PR                  a pull request opened (by anyone, Dependabot included)
 *   PR #<n>: CI_PASSED / CI_FAILED   CI finished for the PR's current head commit
 *   PR #<n>: CI_SLOW                 a CI run (PR or deploy) has been going for more than the limit
 *   PR #<n>: CONFLICT                the PR conflicts with its base branch: rebase it
 *   PR #<n>: MAIN_MOVED              main got commits the PR doesn't have yet: rebase and test again
 *   PR #<n>: APPROVED                the owner approved (enable auto-merge once it is well reviewed)
 *   PR #<n>: READY_TO_MERGE          approved, CI green for the current head, auto-merge still off
 *   PR #<n>: ACTIVITY                new comments, reviews (also a pending review's comments), review comments
 *   PR #<n>: DEPLOYED / DEPLOY_FAILED  merged, and the deploy run on main finished
 *   PR #<n>: CLOSED                  closed without merging
 *   MAIN_ADVANCED                    main got a new commit (a merge, whoever made it)
 *   MAIN_PASSED / MAIN_FAILED        the newest CI run on main passed, or failed whichever PR caused it
 *   MAIN_SLOW                        the newest CI run on main hangs
 *   NEW_ISSUE / ISSUE_COMMENT        a new issue (not the agent's own), or the owner commented on one
 *   ISSUE_CLOSED / ISSUE_REOPENED    an issue was closed (by anyone) or reopened
 *   IDLE                             nothing happened for max-hours (with --follow: a heartbeat, then it goes on)
 *   WATCHER_ERROR                    a look failed (e.g. a state file stayed locked); it goes on with the next
 *   Usage: session <n>% used (<m>% left, resets …), week <n>% used (<m>% left, resets …)
 *                                    last on every notification: the owner's Claude usage (#233)
 *   REMINDER: PR #<n> …              after every notification, each open PR that waits on the agent: a
 *                                    branch behind main or in conflict, or approved with CI finished
 *                                    (auto-merge to enable, or CI to fix)
 *
 * Every CI result (a PR's, a deploy's or main's) ends with the list of open PRs.
 *
 *   bun packages/watcher/src/watch-project.ts [--follow] [ci-limit-minutes=20] [max-hours=12]
 *
 * Open pull requests are watched, and every one seen open stays watched until its deploy (or its
 * closing) is reported; merged ones from the last few hours too, for a fresh state. Each follows its
 * PR's *current* head commit, so a push needs no restart. It remembers what it reported
 * (watch-state.ts), so start it again after handling the events and it continues with the next ones.
 * Run it in the background: its exit is the notification. Bun reads the whole file before running
 * it, so editing the checkout meanwhile is harmless.
 *
 * With `--follow` it keeps running instead (#196): each event is printed the moment it is found
 * (#240), ending with a `---` line, for a harness that wakes on new output (Claude Code's Monitor), so
 * one watcher lasts the whole session; the reminders and the usage close each look that found any.
 * Following, two pollers run side by side (#240): one for what someone waits for an answer to (new
 * issues, the owner's comments, every followed PR's comments and reviews), every 30 s; one for main
 * and each PR's CI, reviews and deploy, every 60 s. The PRs are checked at once, with at most
 * GH_PARALLEL `gh` calls running, so one slow call holds back only its own events.
 */
import { FOLLOW_NEWER, cancelledDeployEvent, mainRunEvent, runEvent } from './watch-events'
import { type PrState, REPO, jobLines, mainAhead, mainHead, mergeCommand, newestMainRun, openPrs, prStates, recentlyMerged, runOf } from './watch-github'
import { FOLLOW, flush, queue, quiet, report } from './watch-output'
import { addLine, lock, readLines, updateLines, writeLines } from './watch-state'
import { checkActivity as checkPrActivity, checkTrackedActivity } from './watch-activity'
import { checkIssueStates, checkIssues } from './watch-issues'
import { allSettled, hasText } from './read'

const [limitMinutes = '20', maxHours = '12'] = process.argv.slice(2).filter(arg => arg !== '--follow')
if (!/^\d+$/u.test(limitMinutes) || !/^\d+$/u.test(maxHours)) {
  process.stderr.write('ci-limit-minutes and max-hours must be whole numbers\n')
  process.exit(64)
}
const LIMIT_SECONDS = Number(limitMinutes) * 60
const MERGED_HOURS = Number(process.env.MERGED_HOURS ?? 3)
const round = { complete: true }
/** Read through a function: the checks of a round reset `round.complete`, which TypeScript can't see. */
const roundComplete = () => round.complete

const short = (sha: string) => sha.slice(0, 7)
const byNumber = (first: number, second: number) => first - second

const inOrder = async <Item>(items: readonly Item[], each: (item: Item) => Promise<unknown>): Promise<void> =>
  items.reduce<Promise<void>>(async (previous, item) => {
    await previous
    await each(item)
  }, Promise.resolve())

/** A PR's new comments and reviews; a PR whose comments couldn't be read leaves the round incomplete. */
const checkActivity = async (pr: number): Promise<boolean> => {
  const read = await checkPrActivity(pr)
  round.complete &&= read
  return read
}

/** A finished or slow CI run of `sha`: a PR's head, or a merged PR's commit on main (`deploy`). */
const checkRun = async (pr: number, sha: string, label: 'pr' | 'deploy'): Promise<void> => {
  const run = await runOf(sha).catch(() => null)
  // Jobs that can't be read yet: the result waits a look rather than coming out without them.
  const jobs = run ? await jobLines(run.id).catch(() => null) : null
  if (!run || !jobs) {
    return
  }
  const outcome = runEvent({ jobs, label, limitSeconds: LIMIT_SECONDS, pr, repo: REPO, run, sha })
  if (outcome !== FOLLOW_NEWER) {
    await report(outcome, pr)
    return
  }
  // The deploy job keeps at most one deploy waiting: a newer merge cancels an older one still waiting,
  // and the newer run deploys this commit too. Follow that one; without one, it is a failure.
  const newest = await newestMainRun().catch(() => null)
  await (newest && newest.sha !== sha ? checkRun(pr, newest.sha, 'deploy') : report(cancelledDeployEvent({ jobs, pr, run, sha }), pr))
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
  // own merge is then a commit main has (#249): ask again, and say nothing unless it is still open. A
  // failed read says nothing either: the next look asks again.
  // Asked only while it is news: a branch left behind main isn't asked about on every look.
  const key = `pr-${pr} main-moved ${newest}`
  const news = ahead > 0 && !(await readLines('reported')).includes(key)
  const stillOpen = news && await prStates([pr]).then(states => states.get(pr)?.state === 'OPEN', () => false)
  await report(stillOpen ? { key, lines: [`MAIN_MOVED: main is ${ahead} commit(s) ahead of the branch: rebase on main and run the checks again`] } : null, pr)
}

const untrack = async (pr: number) => updateLines('tracked', lines => lines.filter(line => line !== String(pr)))
const tracked = async (pr: number) => (await readLines('tracked')).includes(String(pr))

/** A merged PR: its comments while followed (#129), then its deploy until that is reported. */
const checkMerged = async (pr: number, mergeSha: string): Promise<void> => {
  if (await tracked(pr) && !await checkActivity(pr)) {
    return
  }
  const deployed = (await readLines('reported')).some(line => line.startsWith(`pr-${pr} deployed `))
  await (deployed ? untrack(pr) : checkRun(pr, mergeSha, 'deploy'))
}

const checkClosed = async (pr: number): Promise<void> => {
  if (await tracked(pr) && !await checkActivity(pr)) {
    return
  }
  await untrack(pr)
  await report({ key: `pr-${pr} closed`, lines: ['CLOSED without merging'] }, pr)
}

/** Conflicts and approvals, which a parked PR (left open on purpose) doesn't report. */
const checkReview = async (pr: number, state: PrState): Promise<void> => {
  await report(state.mergeable === 'CONFLICTING' ? { key: `pr-${pr} conflict ${state.head}`, lines: [`CONFLICT at ${short(state.head)}: rebase on main`] } : null, pr)
  await report(state.decision === 'APPROVED' ? { key: `pr-${pr} approved`, lines: [`APPROVED by the owner. Once it is well reviewed, enable auto-merge: ${mergeCommand(pr)}`] } : null, pr)
}

/** Approved and green for the current head, but auto-merge is still off. */
const checkReady = async (pr: number, state: PrState): Promise<void> => {
  const green = (await readLines('reported')).includes(`pr-${pr} ci-passed ${state.head}`)
  const ready = state.decision === 'APPROVED' && !state.autoMerge && green
  await report(ready ? { key: `pr-${pr} ready ${state.head}`, lines: [`READY_TO_MERGE: approved and CI is green at ${short(state.head)}, but auto-merge is off. Enable it: ${mergeCommand(pr)}`] } : null, pr)
}

const checkOpen = async (pr: number, state: PrState): Promise<void> => {
  await addLine('tracked', String(pr))
  await report({ key: `pr-${pr} opened`, lines: [`NEW_PR: ${state.title}`] }, pr)
  // Comments before the approval: an approval often comes with review comments, and reporting it
  // first meant auto-merge went on before they were read (#152). While the comments can't be read,
  // the approval waits too.
  const commentsRead = await checkActivity(pr)
  // A PR labelled `parked` is left open on purpose: only its CI and comments are news.
  const reviewNews = commentsRead && !state.parked
  await (reviewNews ? checkReview(pr, state) : Promise.resolve())
  await checkRun(pr, state.head, 'pr')
  await (reviewNews ? checkReady(pr, state).then(async () => checkMoved(pr, state.head)) : Promise.resolve())
}

const checkPr = async (pr: number, state: PrState | undefined): Promise<void> => {
  if (!state) {
    round.complete = false
    return
  }
  if (state.state === 'MERGED') {
    await checkMerged(pr, state.mergeSha)
    return
  }
  await (state.state === 'CLOSED' ? checkClosed(pr) : checkOpen(pr, state))
}

/** Open PRs, the ones followed until their deploy, and recently merged ones; null when a listing failed. */
const watchedPrs = async (): Promise<number[] | null> => {
  const lists = await Promise.all([
    openPrs().then(prs => prs.map(pr => pr.number)),
    recentlyMerged(MERGED_HOURS),
    readLines('tracked').then(lines => lines.map(Number)),
    readLines('reported'),
  ]).catch(() => null)
  if (!lists) {
    return null
  }
  const [open, merged, followed, reported] = lists
  // A merged PR whose deploy was reported, and that is no longer followed, needs no look: on a slow
  // `gh` each look costs seconds, all of it before the rest (#235). Only the deploy settles it: a PR
  // closed once and then reopened and merged still has its deploy to report.
  const settled = (pr: number) => reported.some(line => line.startsWith(`pr-${pr} deployed `))
  const unsettled = merged.filter(pr => followed.includes(pr) || !settled(pr))
  return [...new Set([...open, ...unsettled, ...followed])].toSorted(byNumber)
}

const checkPrs = async (): Promise<void> => {
  // A round with a failed listing is skipped rather than run with pull requests missing.
  const prs = await watchedPrs()
  const states = prs ? await prStates(prs) : null
  if (!prs || !states) {
    return
  }
  round.complete = true
  // All at once (#240): a slow PR holds back only its own events; GH_PARALLEL caps the calls.
  await allSettled(prs.map(async pr => checkPr(pr, states.get(pr))))
  // From here on, a PR seen for the first time is a new one. Only after a round in which every PR
  // answered: one that failed must still get its comments recorded.
  await (roundComplete() ? writeLines('initialized', []) : Promise.resolve())
}

type Check = () => Promise<void>

/** What someone waits for an answer to: issues, the owner's comments on them and on the PRs followed. */
const ANSWER_CHECKS: Check[] = [checkIssues, checkIssueStates, checkTrackedActivity]
/** The rest: main, and each PR's CI, reviews and deploy. */
const PROJECT_CHECKS: Check[] = [checkMain, checkMainHead, checkPrs]

interface Poller {
  checks: readonly Check[]
  /** Whether this poller prints the IDLE heartbeat: only one does, or both would. */
  heartbeat: boolean
  pauseSeconds: number
}

/** One look; true when it printed events, so the next look comes at once. */
const lookOnce = async ({ checks, heartbeat }: Poller): Promise<boolean> => {
  await inOrder(checks, async check => check())
  if (await flush()) {
    return true
  }
  // After a heartbeat the next look waits like after an empty round.
  if (heartbeat && Temporal.Instant.compare(Temporal.Now.instant(), quiet.since.add({ hours: Number(maxHours) })) > 0) {
    queue([`IDLE: nothing happened for ${maxHours} h`])
    await flush()
  }
  return false
}

/**
 * A look that fails (a state file still locked after its retries, #231) is reported as an event, and
 * the watcher goes on with the next look instead of stopping: events would otherwise end unnoticed.
 */
const lookSafely = async (poller: Poller): Promise<boolean> => lookOnce(poller).catch(async (error: unknown) => {
  queue([`WATCHER_ERROR: ${error instanceof Error ? error.message : 'the look failed'}; still watching`])
  await flush()
  return false
})

/** Looks again and again, `pauseSeconds` apart after a look that found nothing. */
const poll = async (poller: Poller): Promise<never> => {
  // A loop rather than a function awaiting itself: following, the watcher runs for a whole session.
  for (;;) {
    await (await lookSafely(poller) ? Promise.resolve() : Bun.sleep(poller.pauseSeconds * 1000))
  }
}

await lock()
// Following, two pollers run side by side (#240): the answers every 30 s, never waiting for a slow
// look at CI and deploys. Without `--follow`, one look at everything, the answers first (#235).
await (FOLLOW
  ? Promise.all([poll({ checks: ANSWER_CHECKS, heartbeat: false, pauseSeconds: 30 }), poll({ checks: PROJECT_CHECKS, heartbeat: true, pauseSeconds: 60 })])
  : poll({ checks: [...ANSWER_CHECKS, ...PROJECT_CHECKS], heartbeat: true, pauseSeconds: 60 }))
