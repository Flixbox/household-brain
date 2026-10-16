/** What the project watcher reports, decided from what GitHub answered (pure, so it is tested). */

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

/** A cancelled deploy that no newer run replaces is a failure: someone has to re-run it. */
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
  parked: boolean
  checks: string[]
  /** GitHub's `mergeStateStatus`: `BEHIND` (out of date with the base branch), `DIRTY` (conflicts), … */
  mergeState: string
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
const approvalProblem = (pr: OpenPr): string | null => {
  if (pr.reviewDecision !== 'APPROVED') {
    return null
  }
  // No checks at all means CI hasn't reported yet, not that it passed.
  const ci = pr.checks.length > 0 ? ciState(pr.checks) : 'running'
  if (ci === 'failed') {
    return `REMINDER: PR #${pr.number} is approved and CI failed: fix it.`
  }
  return ci === 'green' && !pr.autoMerge ? `REMINDER: PR #${pr.number} is approved and CI is green, but auto-merge is off: enable it.` : null
}

/**
 * A reminder for each open PR that waits on the agent, repeated on every notification until it is
 * dealt with: a branch behind main or in conflict (#226), approved with green CI and auto-merge off,
 * or approved with failed CI (#224). Parked PRs don't count.
 */
export const reminderLines = (prs: readonly OpenPr[]): string[] => prs
  .filter(pr => !pr.parked)
  .flatMap(pr => [branchProblem(pr), approvalProblem(pr)].filter(line => line !== null))

/**
 * The review decision from the reviews themselves, each reviewer's latest that counts (a comment
 * doesn't undo an approval, a dismissal does), for when GitHub leaves `reviewDecision` empty: it only
 * fills it in under classic branch protection, not under a ruleset (#197).
 */
export const decisionFrom = (reviews: readonly { login: string, state: string }[]): string => {
  const latest = new Map<string, string>()
  for (const { login, state } of reviews) {
    if (state === 'APPROVED' || state === 'CHANGES_REQUESTED' || state === 'DISMISSED') {
      latest.set(login, state)
    }
  }
  const states = new Set(latest.values())
  if (states.has('CHANGES_REQUESTED')) {
    return 'CHANGES_REQUESTED'
  }
  return states.has('APPROVED') ? 'APPROVED' : ''
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

export const openPrLines = (prs: OpenPr[]): string[] => [
  'Open PRs:',
  ...prs.map(pr => `  #${pr.number} ${pr.title.slice(0, 60)}: ${pr.parked ? 'parked, ' : ''}${review(pr.reviewDecision)}, auto-merge ${pr.autoMerge ? 'on' : 'off'}, CI ${ciState(pr.checks)}${branchState(pr.mergeState)}`),
]

/** Event keys after which the open PRs are listed. */
export const listsOpenPrs = (key: string) => /ci-passed|ci-failed|deployed|deploy-failed|main-passed|main-failed/u.test(key)

export interface Activity {
  /** `comment`, `review` or `review-comment`, with its id: what is remembered as seen. */
  id: string
  line: string
}

/** Activity not seen before, in the order GitHub gave it. */
export const newActivity = (seen: ReadonlySet<string>, items: Activity[]): Activity[] =>
  items.filter((item, index) => !seen.has(item.id) && items.findIndex(other => other.id === item.id) === index)

/** Issue events are remembered by their first 80 characters (a title or comment may change later). */
export const issueKey = (line: string) => line.slice(0, 80)

/** Events that ask the agent to answer someone: comments, reviews, approvals, conflicts, new issues. */
const ANSWER_FIRST = /^(?:PR #\d+: )?(?:ACTIVITY|APPROVED|READY_TO_MERGE|CONFLICT|NEW_ISSUE|ISSUE_COMMENT)\b/u

/**
 * A round's events in the order to print them (#222): what someone waits for an answer to first, then
 * CI, deploys and the rest, each group in the order it was found.
 */
export const answerFirst = (events: readonly (readonly string[])[]): (readonly string[])[] =>
  events.toSorted((first, second) => Number(!ANSWER_FIRST.test(first[0] ?? '')) - Number(!ANSWER_FIRST.test(second[0] ?? '')))
