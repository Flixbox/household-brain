/**
 * Watches the whole project until something needs attention, then prints it and exits:
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
 *   IDLE                             nothing happened for max-hours
 *
 * Every CI result (a PR's, a deploy's or main's) ends with the list of open PRs.
 *
 *   bun packages/tooling/src/watch-project.ts [ci-limit-minutes=20] [max-hours=12]
 *
 * Open pull requests are watched, and every one seen open stays watched until its deploy (or its
 * closing) is reported; merged ones from the last few hours too, for a fresh state. Each follows its
 * PR's *current* head commit, so a push needs no restart. It remembers what it reported
 * (watch-state.ts), so start it again after handling each event and it continues with the next one.
 * Run it in the background: its exit is the notification. Bun reads the whole file before running
 * it, so editing the checkout meanwhile is harmless.
 */
import { Temporal } from 'temporal-polyfill'
import { type Activity, type Event, FOLLOW_NEWER, cancelledDeployEvent, issueKey, listsOpenPrs, mainRunEvent, newActivity, openPrLines, runEvent } from './watch-events'
import { type PrState, REPO, activityOf, issueEventLines, issueLine, jobLines, mainAhead, mainHead, newestMainRun, openIssueNumbers, openPrs, prState, recentlyMerged, reviewCommentLines, runOf } from './watch-github'
import { appendLines, exists, lock, readLines, writeLines } from './watch-state'

const [, , limitMinutes = '20', maxHours = '12'] = process.argv
if (!/^\d+$/u.test(limitMinutes) || !/^\d+$/u.test(maxHours)) {
  process.stderr.write('ci-limit-minutes and max-hours must be whole numbers\n')
  process.exit(64)
}
const LIMIT_SECONDS = Number(limitMinutes) * 60
const MERGED_HOURS = Number(process.env.MERGED_HOURS ?? 3)
const started = Temporal.Now.instant()
const round = { complete: true }

const say = (lines: readonly string[]) => process.stdout.write(`${lines.join('\n')}\n`)
const short = (sha: string) => sha.slice(0, 7)
const byNumber = (first: number, second: number) => first - second

/** Prints the event and exits, unless there is none or it was reported before. */
const report = async (event: Event | null, pr: number | null = null): Promise<void> => {
  if (!event || (await readLines('reported')).includes(event.key)) {
    return
  }
  await appendLines('reported', [event.key])
  const [first = '', ...rest] = event.lines
  say([pr === null ? first : `PR #${pr}: ${first}`, ...rest])
  // Every CI result comes with where each open PR stands, so no approval goes unnoticed.
  if (listsOpenPrs(event.key)) {
    say(await openPrs().then(openPrLines, () => ['Open PRs: (listing failed)']))
  }
  process.exit(0)
}

/** Prints lines that aren't keyed events (activity, issues) and exits. */
const sayAndExit = (lines: readonly string[]): never => {
  say(lines)
  return process.exit(0)
}

const inOrder = <Item>(items: readonly Item[], each: (item: Item) => Promise<unknown>): Promise<void> =>
  items.reduce<Promise<void>>(async (previous, item) => {
    await previous
    await each(item)
  }, Promise.resolve())

/** The comments of a PR already reported. On the very first round, the ones already there are old news. */
const seenActivity = async (pr: number, items: Activity[]): Promise<Set<string>> => {
  const seenFile = `pr-${pr}-seen`
  // A PR that appears later is new, and so is everything on it, also what came between its NEW_PR
  // and this look (#122).
  if (!await exists(seenFile)) {
    await writeLines(seenFile, await exists('initialized') ? [] : items.map(item => item.id))
  }
  return new Set(await readLines(seenFile))
}

/** New comments and reviews on a PR; false when GitHub couldn't be asked (tried again next round). */
const checkActivity = async (pr: number): Promise<boolean> => {
  const items = await activityOf(pr).catch(() => null)
  if (!items) {
    round.complete = false
    return false
  }
  const fresh = newActivity(await seenActivity(pr, items), items)
  if (fresh.length === 0) {
    return true
  }
  await appendLines(`pr-${pr}-seen`, fresh.map(item => item.id))
  const lines = await Promise.all(fresh.map(async item =>
    [item.line].concat(item.id.startsWith('review ') ? await reviewCommentLines(pr, item.id.split(' ')[1] ?? '').catch(() => []) : [])))
  return sayAndExit([`PR #${pr}: ACTIVITY:`, ...lines.flat()])
}

/** A finished or slow CI run of `sha`: a PR's head, or a merged PR's commit on main (`deploy`). */
const checkRun = async (pr: number, sha: string, label: 'pr' | 'deploy'): Promise<void> => {
  const run = await runOf(sha).catch(() => null)
  if (!run) {
    return
  }
  const jobs = await jobLines(run.id).catch(() => [])
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
  if (!head?.sha) {
    return
  }
  const [known] = await readLines('main')
  await writeLines('main', [head.sha])
  const moved = Boolean(known) && known !== head.sha
  await report(moved ? { key: `main-head ${head.sha}`, lines: [`MAIN_ADVANCED: main is at ${short(head.sha)}: ${head.subject}`] } : null)
}

/** Main has commits the PR's branch doesn't. A PR merged meanwhile isn't moved: that commit is its own merge. */
const checkMoved = async (pr: number, head: string): Promise<void> => {
  const { ahead, newest } = await mainAhead(head).catch(() => ({ ahead: 0, newest: '-' }))
  const open = ahead > 0 && (await prState(pr).catch(() => null))?.state === 'OPEN'
  await report(open ? { key: `pr-${pr} main-moved ${newest}`, lines: [`MAIN_MOVED: main is ${ahead} commit(s) ahead of the branch: rebase on main and run the checks again`] } : null, pr)
}

const untrack = async (pr: number) => writeLines('tracked', (await readLines('tracked')).filter(line => line !== String(pr)))
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

const mergeCommand = (pr: number) => `agent-gh pr merge ${pr} --auto --squash`

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
  if (!await tracked(pr)) {
    await appendLines('tracked', [String(pr)])
  }
  await report({ key: `pr-${pr} opened`, lines: [`NEW_PR: ${state.title}`] }, pr)
  // Comments before the approval: an approval often comes with review comments, and reporting it
  // first meant auto-merge went on before they were read (#152). While the comments can't be read,
  // the approval waits too.
  const commentsRead = await checkActivity(pr)
  // A PR labelled `parked` is left open on purpose: only its CI and comments are news.
  const reviewNews = commentsRead && !state.parked
  await (reviewNews ? checkReview(pr, state) : Promise.resolve())
  await checkRun(pr, state.head, 'pr')
  await (reviewNews ? checkReady(pr, state).then(() => checkMoved(pr, state.head)) : Promise.resolve())
}

const checkPr = async (pr: number): Promise<void> => {
  const state = await prState(pr).catch(() => null)
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

/** On the very first run, a state file starts from what is there now: none of it is news. */
const firstRun = async (name: string, lines: string[]): Promise<boolean> => {
  if (await exists(name)) {
    return false
  }
  await writeLines(name, lines)
  return true
}

/** Issues and the owner's comments on them not reported yet; the ones from before the first run aren't news. */
const checkIssues = async (): Promise<void> => {
  const lines = await issueEventLines().catch(() => null)
  if (!lines || await firstRun('issues', lines.map(issueKey))) {
    return
  }
  const seen = new Set(await readLines('issues'))
  const fresh = lines.filter(line => !seen.has(issueKey(line)))
  if (fresh.length > 0) {
    await appendLines('issues', fresh.map(issueKey))
    sayAndExit(fresh)
  }
}

/** Issue lines for what was closed or reopened between `before` and `now`; null when a lookup failed. */
const issueChanges = (before: string[], now: string[]): Promise<string[] | null> =>
  Promise.all([
    ...before.filter(issue => !now.includes(issue)).map(issue => issueLine(Number(issue), 'closed')),
    ...now.filter(issue => !before.includes(issue)).map(issue => issueLine(Number(issue), 'reopened')),
  ]).then(lines => lines.filter(line => line !== null), () => null)

/** Issues closed or reopened since the last round. A failed lookup leaves the state as it was, so the next round tries again. */
const checkIssueStates = async (): Promise<void> => {
  const now = await openIssueNumbers().then(numbers => numbers.toSorted(byNumber).map(String), () => null)
  if (!now || await firstRun('open-issues', now)) {
    return
  }
  const lines = await issueChanges(await readLines('open-issues'), now)
  if (!lines) {
    return
  }
  await writeLines('open-issues', now)
  if (lines.length > 0) {
    sayAndExit(lines)
  }
}

/** Open PRs, the ones followed until their deploy, and recently merged ones; null when a listing failed. */
const watchedPrs = async (): Promise<number[] | null> => {
  const lists = await Promise.all([
    openPrs().then(prs => prs.map(pr => pr.number)),
    recentlyMerged(MERGED_HOURS),
    readLines('tracked').then(lines => lines.map(Number)),
  ]).catch(() => null)
  return lists ? [...new Set(lists.flat())].toSorted(byNumber) : null
}

const checkPrs = async (): Promise<void> => {
  // A round with a failed listing is skipped rather than run with pull requests missing.
  const prs = await watchedPrs()
  if (!prs) {
    return
  }
  round.complete = true
  await inOrder(prs, checkPr)
  // From here on, a PR seen for the first time is a new one. Only after a round in which every PR
  // answered: one that failed must still get its comments recorded.
  await (round.complete ? writeLines('initialized', []) : Promise.resolve())
}

const watchRound = async (): Promise<void> => {
  await inOrder([checkMain, checkMainHead, checkIssues, checkIssueStates, checkPrs], check => check())
  if (Temporal.Instant.compare(Temporal.Now.instant(), started.add({ hours: Number(maxHours) })) > 0) {
    sayAndExit([`IDLE: nothing happened for ${maxHours} h`])
  }
  await Bun.sleep(60_000)
  await watchRound()
}

await lock()
await watchRound()
