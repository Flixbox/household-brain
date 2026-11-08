/* oxlint-disable eslint/no-await-in-loop -- a run's replacements are tried one after another, on purpose */
/** What the project watcher does with a CI run of a commit (watch-main.ts asks, for each PR it follows). */
import { FOLLOW_NEWER, type MainRun, type Run, cancelledDeployEvent, replacementCandidates, runEvent } from './watch-events'
import { REPO, containsCommit, jobLines, mainRuns, runOf } from './watch-github'
import { holdsLagging, isSettled, keepJobs, keptJobs, settle } from './watch-ci-cache'
import { report } from './watch-output'

interface RunCheck {
  label: 'pr' | 'deploy'
  limitSeconds: number
  pr: number
  sha: string
}

/** A question to GitHub that failed: the next look asks again. */
const UNKNOWN = 'unknown'

/** The first of the runs whose commit contains `sha`: null when none does. */
const firstContaining = async (candidates: readonly MainRun[], sha: string): Promise<MainRun | null | typeof UNKNOWN> => {
  for (const candidate of candidates) {
    const contains = await containsCommit(candidate.sha, sha).catch(() => UNKNOWN)
    if (contains !== false) {
      return contains === UNKNOWN ? UNKNOWN : candidate
    }
  }
  return null
}

/** Reports what the run came to; a run that completed is then finished with (#401). */
const reportRun = async ({ check, jobs, run }: { check: RunCheck, jobs: string[], run: Run }): Promise<void> => {
  const { label, limitSeconds, pr, sha } = check
  const outcome = runEvent({ jobs, label, limitSeconds, pr, repo: REPO, run, sha })
  if (outcome === FOLLOW_NEWER) {
    keepJobs(run, jobs)
    await followNewer({ jobs, limitSeconds, pr, run, sha })
    return
  }
  await report(outcome, pr)
  if (run.status === 'completed') { settle(check, run) }
}

/** A finished or slow CI run of `sha`: a PR's head, or a merged PR's commit on main (`deploy`). */
export const checkRun = async (check: RunCheck): Promise<void> => {
  const run = await runOf(check.sha).catch(() => null)
  if (run && isSettled(check, run)) {
    return
  }
  // Jobs that can't be read yet: the result waits a look rather than coming out without them.
  const jobs = run ? keptJobs(run) ?? await jobLines(run, holdsLagging).catch(() => null) : null
  await (run && jobs ? reportRun({ check, jobs, run }) : Promise.resolve())
}

/**
 * The deploy job keeps at most one deploy waiting: a newer merge cancels an older one still waiting,
 * and the newer run deploys this commit too. Follow a newer run on main whose commit contains this
 * one, one that passed or still runs before any other (#270); without one, it is a failure. A question
 * that fails reports nothing: the next look asks again.
 */
const followNewer = async ({ jobs, limitSeconds, pr, run, sha }: { jobs: string[], limitSeconds: number, pr: number, run: Run, sha: string }): Promise<void> => {
  const runs = await mainRuns().catch(() => null)
  const replacement = runs ? await firstContaining(replacementCandidates(run, sha, runs), sha) : UNKNOWN
  if (replacement === UNKNOWN) {
    return
  }
  await (replacement ? checkRun({ label: 'deploy', limitSeconds, pr, sha: replacement.sha }) : report(cancelledDeployEvent({ jobs, pr, run, sha }), pr))
}
