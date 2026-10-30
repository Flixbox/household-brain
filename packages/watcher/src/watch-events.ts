/** What the project watcher reports, decided from what GitHub answered (pure, so it is tested). */
import { isRecord } from './read'

export interface Event {
  /** Remembered once reported, so the same event is never reported twice. */
  key: string
  lines: string[]
}

export interface Run {
  id: number
  attempt: number
  status: string
  /** '' while the run hasn't finished. */
  conclusion: string
  /** When the current attempt started, so a re-run is timed from its own start. */
  ageSeconds: number
}

interface RunContext {
  pr: number
  sha: string
  /** `pr`: a PR's head commit; `deploy`: a merged PR's commit on main. */
  label: 'pr' | 'deploy'
  run: Run
  jobs: string[]
  limitSeconds: number
  repo: string
}

/** A cancelled deploy whose commit a newer run on main deploys too: follow that one. */
export const FOLLOW_NEWER = 'follow-newer'

const short = (sha: string) => sha.slice(0, 7)

const finishedEvent = ({ pr, sha, label, run, jobs, repo }: RunContext): Event | typeof FOLLOW_NEWER | null => {
  if (label === 'deploy') {
    if (run.conclusion === 'cancelled') {
      return FOLLOW_NEWER
    }
    return run.conclusion === 'success'
      ? { key: `pr-${pr} deployed ${sha}`, lines: [`DEPLOYED: live (run ${run.id})`, ...jobs] }
      : { key: `pr-${pr} deploy-failed ${sha} ${run.attempt}`, lines: [`DEPLOY_FAILED: run ${run.id} on main ended ${run.conclusion}: open a follow-up PR`, ...jobs] }
  }
  if (run.conclusion === 'success') {
    return { key: `pr-${pr} ci-passed ${sha}`, lines: [`CI_PASSED for ${short(sha)} (run ${run.id})`, ...jobs] }
  }
  // Cancelled: a newer push superseded it.
  if (run.conclusion === 'cancelled') {
    return null
  }
  // Keyed by attempt too, so a re-run that fails again is reported again.
  return {
    key: `pr-${pr} ci-failed ${sha} ${run.attempt}`,
    lines: [`CI_FAILED for ${short(sha)} (run ${run.id}): ${run.conclusion}. gh run view ${run.id} --repo ${repo} --log-failed`, ...jobs],
  }
}

/** A PR's (or its deploy's) CI run: finished, or running longer than the limit. */
export const runEvent = (context: RunContext): Event | typeof FOLLOW_NEWER | null => {
  const { pr, sha, label, run, jobs, limitSeconds } = context
  if (run.status === 'completed') {
    return finishedEvent(context)
  }
  return run.ageSeconds > limitSeconds
    ? {
      key: `pr-${pr} ci-slow ${run.id} ${run.attempt}`,
      lines: [`CI_SLOW: run ${run.id} (${label}, ${short(sha)}) still ${run.status} after ${Math.floor(run.ageSeconds / 60)} min. Cancel it and read the logs.`, ...jobs],
    }
    : null
}

/** A CI run on main, and its commit. */
export interface MainRun {
  run: Run
  sha: string
}

/**
 * The runs on main that may replace a cancelled deploy of `sha` (#270), in the order to try them: the
 * newer ones that passed or still run first (they deploy the commit, or will), then the other newer
 * ones, each group newest first. Runs of the same commit don't count: following one would come back
 * to the cancelled run. Whether a run's commit contains `sha` is for the caller to ask.
 */
export const replacementCandidates = (cancelled: Run, sha: string, runs: readonly MainRun[]): MainRun[] => {
  const newer = runs.filter(main => main.run.id > cancelled.id && main.sha !== sha).toSorted((first, second) => second.run.id - first.run.id)
  const live = (main: MainRun) => main.run.status !== 'completed' || main.run.conclusion === 'success'
  return [...newer.filter(main => live(main)), ...newer.filter(main => !live(main))]
}

/** A cancelled deploy that no newer run on main replaces is a failure: someone has to re-run it. */
export const cancelledDeployEvent = ({ pr, sha, run, jobs }: Pick<RunContext, 'pr' | 'sha' | 'run' | 'jobs'>): Event => ({
  key: `pr-${pr} deploy-failed ${sha} ${run.attempt}`,
  lines: [`DEPLOY_FAILED: run ${run.id} on main was cancelled, and no newer run replaces it: re-run it`, ...jobs],
})

/** The newest CI run on main, whichever PR it came from. */
export const mainRunEvent = ({ run, limitSeconds, repo }: { run: Run, limitSeconds: number, repo: string }): Event | null => {
  if (run.status === 'completed') {
    if (run.conclusion === 'cancelled') {
      return null
    }
    return run.conclusion === 'success'
      ? { key: `main-passed ${run.id} ${run.attempt}`, lines: [`MAIN_PASSED: CI run ${run.id} on main passed`] }
      : {
        key: `main-failed ${run.id} ${run.attempt}`,
        lines: [`MAIN_FAILED: CI run ${run.id} on main ended ${run.conclusion}. Fix main first (follow-up PR). gh run view ${run.id} --repo ${repo} --log-failed`],
      }
  }
  return run.ageSeconds > limitSeconds
    ? { key: `main-slow ${run.id} ${run.attempt}`, lines: [`MAIN_SLOW: CI run ${run.id} on main still ${run.status} after ${Math.floor(run.ageSeconds / 60)} min. Cancel it and read the logs.`] }
    : null
}

export interface OpenPr {
  number: number
  title: string
  reviewDecision: string
  autoMerge: boolean
  draft: boolean
  bot: { asked: string[], requested: boolean, reviewed: string[], reviewing: boolean }
  parked: boolean
  checks: string[]
  /** GitHub's `mergeStateStatus`: `BEHIND` (out of date with the base branch), `DIRTY` (conflicts), … */
  mergeState: string
  /** In the merge queue (#251): auto-merge shows as off there, and enabling it only says "already queued". */
  queued: boolean
}

const FAILED = new Set(['FAILURE', 'ERROR', 'TIMED_OUT', 'CANCELLED', 'STARTUP_FAILURE', 'ACTION_REQUIRED'])
const DONE = new Set(['SUCCESS', 'SKIPPED', 'NEUTRAL'])

const ciState = (checks: string[]) => {
  if (checks.some(check => FAILED.has(check))) {
    return 'failed'
  }
  return checks.every(check => DONE.has(check)) ? 'green' : 'running'
}

/** A branch that can't merge as it is (#226): behind the base branch, or in conflict with it. */
const branchProblem = (pr: OpenPr): string | null => {
  if (pr.mergeState === 'DIRTY') {
    return `REMINDER: PR #${pr.number} has conflicts with main: rebase it.`
  }
  return pr.mergeState === 'BEHIND' ? `REMINDER: PR #${pr.number} is behind main: rebase it and run the checks again.` : null
}

/** An approved PR whose CI has finished and that waits on the agent (#224). */
const approvalProblem = (pr: OpenPr, awaitingBot: boolean): string | null => {
  // A queued PR waits on the queue, not on the agent: what goes wrong there comes as DEQUEUED (#251).
  if (pr.reviewDecision !== 'APPROVED' || pr.queued) {
    return null
  }
  // No checks at all means CI hasn't reported yet, not that it passed.
  const ci = pr.checks.length > 0 ? ciState(pr.checks) : 'running'
  if (ci === 'failed') {
    return `REMINDER: PR #${pr.number} is approved and CI failed: fix it.`
  }
  return ci === 'green' && !pr.autoMerge && !pr.draft && !awaitingBot ? `REMINDER: PR #${pr.number} is approved and CI is green, but auto-merge is off: enable it.` : null
}

/**
 * A reminder for each open PR waiting on the agent, on every notification until dealt with: a branch behind
 * main or in conflict (#226), approved with failed CI, or with green CI and auto-merge off (#224), unless it
 * is `awaitingBot`, a review bot's review (#299). Parked PRs don't count.
 */
export const reminderLines = (prs: readonly OpenPr[], awaitingBot: ReadonlySet<number> = new Set()): string[] => prs
  .filter(pr => !pr.parked)
  .flatMap(pr => [branchProblem(pr), approvalProblem(pr, awaitingBot.has(pr.number))].filter(line => line !== null))

/** Each reviewer's latest review that counts (a comment doesn't undo an approval, a dismissal does), by login in lower case. */
const latestReviews = (reviews: readonly { login: string, state: string }[]): Map<string, string> => new Map(reviews
  .filter(({ state }) => state === 'APPROVED' || state === 'CHANGES_REQUESTED' || state === 'DISMISSED')
  .map(({ login, state }): [string, string] => [login.toLowerCase(), state]))

/** Whether `approver`'s own latest counting review approves, whatever others' say: a stale change request keeps GitHub's decision at CHANGES_REQUESTED (#286). */
export const approvedBy = (reviews: readonly { login: string, state: string }[], approver: string): boolean =>
  latestReviews(reviews).get(approver.toLowerCase()) === 'APPROVED'

/**
 * The review decision, with an approval counted only from `approver`, the owner (#277): a bot's or
 * anyone else's approval must not read as the owner's. GitHub's own decision (`given`) stands when it
 * isn't an approval; when it is, the approver's own latest review must say so. Where GitHub leaves it
 * empty (it only fills it in under classic branch protection, not under a ruleset, #197), the reviews
 * decide: each reviewer's latest that counts, anyone's change request outweighing the approval.
 */
export const decisionFrom = (given: string, reviews: readonly { login: string, state: string }[], approver: string): string => {
  if (given !== '' && given !== 'APPROVED') {
    return given
  }
  if (given === '' && [...latestReviews(reviews).values()].includes('CHANGES_REQUESTED')) {
    return 'CHANGES_REQUESTED'
  }
  return approvedBy(reviews, approver) ? 'APPROVED' : ''
}

const review = (decision: string) => {
  if (decision === 'APPROVED') {
    return 'approved'
  }
  return decision === 'CHANGES_REQUESTED' ? 'changes requested' : 'awaiting approval'
}

/** Where each open PR stands; every CI result comes with it, so no approval goes unnoticed. */
const branchState = (mergeState: string) => {
  if (mergeState === 'DIRTY') {
    return ', conflicts with main'
  }
  return mergeState === 'BEHIND' ? ', behind main' : ''
}

const mergeWay = (pr: OpenPr) => {
  if (pr.queued) {
    return 'in the merge queue'
  }
  return `auto-merge ${pr.autoMerge ? 'on' : 'off'}`
}

export const openPrLines = (prs: OpenPr[]): string[] => [
  'Open PRs:',
  ...prs.map(pr => `  #${pr.number} ${pr.title.slice(0, 60)}: ${pr.parked ? 'parked, ' : ''}${pr.draft ? 'draft, ' : ''}${review(pr.reviewDecision)}, ${mergeWay(pr)}, CI ${ciState(pr.checks)}${branchState(pr.mergeState)}`),
]

/** Event keys after which the open PRs are listed. */
export const listsOpenPrs = (key: string) => /ci-passed|ci-failed|deployed|deploy-failed|main-passed|main-failed/u.test(key)

export interface Activity {
  /** `comment`, `review` or `review-comment`, with its id: what is remembered as seen. */
  id: string
  /** Its first line, then its text (#255). */
  lines: string[]
}

/** Activity not seen before, in the order GitHub gave it. */
export const newActivity = (seen: ReadonlySet<string>, items: Activity[]): Activity[] =>
  items.filter((item, index) => !seen.has(item.id) && items.findIndex(other => other.id === item.id) === index)

/** Events that ask the agent to answer someone: comments, reviews, approvals, conflicts, new issues. */
const ANSWER_FIRST = /^(?:\[[^\]]*\] )?(?:PR #\d+: )?(?:ACTIVITY|APPROVED(?:_DRAFT)?|READY_TO_MERGE|CONFLICT|NEW_ISSUE|ISSUE_COMMENT)\b/u

/** A time of day on this machine's clock (`12:09:20`), from an instant or GitHub's timestamp; null when it isn't one. */
export const clockTime = (at: unknown, timeZone = Temporal.Now.timeZoneId()): string | null => {
  try {
    if (typeof at !== 'string' && !(at instanceof Temporal.Instant)) {
      return null
    }
    return Temporal.Instant.from(at).toZonedDateTimeISO(timeZone).toPlainTime().toString({ smallestUnit: 'second' })
  } catch {
    return null
  }
}

/**
 * An event's lines with when the watcher found it in front (#240), and when it was written, for a
 * comment or an issue: `[12:27:03, written 12:09:20] ISSUE_COMMENT …`. The gap between them is the delay.
 */
export const stamped = (lines: readonly string[], found: string, written: string | null = null): string[] => {
  const [first = '', ...rest] = lines
  const when = written === null ? found : `${found}, written ${written}`
  return [`[${when}] ${first}`, ...rest]
}

/**
 * A round's events in the order to print them (#222): what someone waits for an answer to first, then
 * CI, deploys and the rest, each group in the order it was found.
 */
export const answerFirst = (events: readonly (readonly string[])[]): (readonly string[])[] =>
  events.toSorted((first, second) => Number(!ANSWER_FIRST.test(first[0] ?? '')) - Number(!ANSWER_FIRST.test(second[0] ?? '')))

/** The owner's Claude usage line when it can't be read (#233). */
export const UNKNOWN_USAGE = 'Usage: unknown'

/** When a window resets, on this machine's clock (`2026-10-17 14:10`); null when it doesn't say. */
const resetTime = (resetsAt: unknown, timeZone: string): string | null => {
  try {
    return typeof resetsAt === 'string' ? Temporal.Instant.from(resetsAt).toZonedDateTimeISO(timeZone).toPlainDateTime().toString({ smallestUnit: 'minute' }).replace('T', ' ') : null
  } catch {
    return null
  }
}

/**
 * A window's use and what is left as whole percentages that add up to 100 (#238), and when it resets
 * (#233). A utilization outside 0 to 100 is taken as the nearest end.
 */
const windowUse = (window: unknown, timeZone: string): string => {
  if (!isRecord(window) || typeof window.utilization !== 'number') {
    return '?'
  }
  const used = Math.round(Math.min(100, Math.max(0, window.utilization)))
  const reset = resetTime(window.resets_at, timeZone)
  const resets = reset === null ? '' : `, resets ${reset}`
  return `${used}% used (${100 - used}% left${resets})`
}

/** The usage line from the endpoint's answer; "unknown" for anything that isn't one. */
export const usageFrom = (answer: unknown, timeZone = Temporal.Now.timeZoneId()): string =>
  (isRecord(answer) && (isRecord(answer.five_hour) || isRecord(answer.seven_day))
    ? `Usage: session ${windowUse(answer.five_hour, timeZone)}, week ${windowUse(answer.seven_day, timeZone)}`
    : UNKNOWN_USAGE)
