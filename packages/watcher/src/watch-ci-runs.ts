/* oxlint-disable eslint/no-await-in-loop -- a run's replacements are tried one after another, on purpose */
/** What the project watcher does with a CI run of a commit (watch-main.ts asks, for each PR it follows). */
import { FOLLOW_NEWER, type MainRun, type Run, cancelledDeployEvent, mainRunEvent, replacementCandidates, runEvent } from './watch-events'
import { REPO, containsCommit, jobLines, mainRuns, newestMainRun, pushRunOf, runOf } from './watch-github'
import { givesUpJobs, holdsLagging, isSettled, jobsRead, keepJobs, keptJobs, settle } from './watch-ci-cache'
import { isSlow, mainSlowKey } from './watch-ci-slow'
import { report, reportedLines } from './watch-output'
import { subscriptions } from './watch-state'

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

/**
 * A run's jobs; null while they can't be read, so the result waits a look. A running run's are none
 * once their reads have failed a few times in a row (#570): its CI_SLOW or MAIN_SLOW comes out
 * without them instead of never. A finished run's result still waits for them.
 */
const readJobs = async (run: Run, holds: (lagging: Run) => boolean): Promise<string[] | null> =>
  jobLines(run, holds).then(jobs => {
    jobsRead(run)
    return jobs
  }, () => (run.status !== 'completed' && givesUpJobs(run) ? [] : null))

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
  const found = await (check.label === 'deploy' ? pushRunOf(check.sha) : runOf(check.sha)).catch((): typeof UNKNOWN => UNKNOWN)
  if (found === null && check.label === 'deploy') {
    await followContaining(check)
    return
  }
  const run = found === UNKNOWN ? null : found
  if (run && isSettled(check, run)) {
    return
  }
  // Jobs that can't be read yet: the result waits a look rather than coming out without them.
  const jobs = run ? keptJobs(run) ?? await readJobs(run, holdsLagging) : null
  await (run && jobs ? reportRun({ check, jobs, run }) : Promise.resolve())
}

/**
 * A merged commit with no push run (#549): the merge queue pushes a batch at once, and only its tip
 * gets a run, which deploys the whole batch. That is the oldest run on main whose commit contains this
 * one (#558): a later run deploys later batches, and can fail for its own reasons. Main is linear, and
 * its push runs start in push order (the deploy job's queue and `followNewer` rely on that too), so
 * the runs that contain it are the newest ones, up to that run; a binary search finds it with a few
 * compare calls, each answered once (`containsCommit` remembers). None contains it: its run hasn't
 * started. A question that fails reports nothing: the next look asks again.
 */
const followContaining = async ({ limitSeconds, pr, sha }: RunCheck): Promise<void> => {
  const runs = await mainRuns(MAIN_RUNS).catch(() => null)
  const deploying = runs ? await oldestContaining(runs.filter(main => main.sha !== sha).toSorted((first, second) => first.run.id - second.run.id), sha, runs.length < MAIN_RUNS) : UNKNOWN
  await (deploying !== null && deploying !== UNKNOWN ? checkRun({ label: 'deploy', limitSeconds, pr, sha: deploying.sha }) : Promise.resolve())
}

/** Whether the commit of `runs[index]` contains `sha`; false when there is no such run. */
const containsAt = async (runs: readonly MainRun[], index: number, sha: string): Promise<boolean | typeof UNKNOWN> => {
  const run = runs[index]
  return run ? containsCommit(run.sha, sha).catch((): typeof UNKNOWN => UNKNOWN) : false
}

/** How many of main's newest runs a batch-merged commit's deploy is looked for in: one page of GitHub's list. */
const MAIN_RUNS = 100

/**
 * The oldest of `runs` (oldest first) whose commit contains `sha`; those after it contain it too. The
 * newest is asked first: while it doesn't contain `sha`, none does, and one call says so. When the
 * oldest contains it too and older runs weren't read (`complete` false), the run that deployed it may
 * be one of those: unknown, so nothing is reported rather than a later batch's run.
 */
const oldestContaining = async (runs: readonly MainRun[], sha: string, complete: boolean): Promise<MainRun | null | typeof UNKNOWN> => {
  const any = await containsAt(runs, runs.length - 1, sha)
  if (any !== true) {
    return any === UNKNOWN ? UNKNOWN : null
  }
  const index = await firstContainingIndex(runs, sha, runs.length - 1)
  return index === UNKNOWN || (index === 0 && !complete) ? UNKNOWN : runs[index] ?? null
}

/** The index of the first of `runs` whose commit contains `sha`, searched below `last`, whose commit does. */
const firstContainingIndex = async (runs: readonly MainRun[], sha: string, last: number): Promise<number | typeof UNKNOWN> => {
  let [low, high] = [0, last]
  while (low < high) {
    const middle = Math.floor((low + high) / 2)
    const contains = await containsAt(runs, middle, sha)
    if (contains === UNKNOWN) {
      return UNKNOWN
    }
    [low, high] = contains ? [low, middle] : [middle + 1, high]
  }
  return low
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

/**
 * The jobs MAIN_SLOW names (#557), asked for only for a slow run not reported yet, and only by a
 * watcher that reports it: a scoped one drops main's events, so it would ask on every look (#570).
 * Null when they can't be read: the report waits for the next look, as CI_SLOW's does.
 */
const slowJobs = async (run: Run, limitSeconds: number): Promise<string[] | null> => {
  const ask = subscriptions.accepts({}) && isSlow(run, limitSeconds) && !(await reportedLines()).includes(mainSlowKey(run))
  return ask ? readJobs(run, () => false) : []
}

/** The newest CI run on main, whichever PR it came from: passed, failed or slow. */
export const checkMainRun = async (limitSeconds: number): Promise<void> => {
  const newest = await newestMainRun().catch(() => null)
  const jobs = newest && await slowJobs(newest.run, limitSeconds)
  await report(newest && jobs && mainRunEvent({ jobs, limitSeconds, repo: REPO, run: newest.run }))
}
