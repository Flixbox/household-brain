/** What a PR's CI comes to, for the open-PR list and its reminders (watch-events.ts), and NOT_QUEUED (watch-queue-events.ts). */

/** A passed run's report line (#401): a later attempt has its own, so a rerun that passes reports too. */
export const ciPassedKey = (pr: number, sha: string, attempt: number): string => {
  const key = `pr-${pr} ci-passed ${sha}`
  return attempt > 1 ? `${key} ${attempt}` : key
}

/** The highest attempt reported under `key`: a line without a number is attempt 1, none at all 0. */
const highestAttempt = (reported: readonly string[], key: string): number =>
  Math.max(0, ...reported.filter(line => line === key || line.startsWith(`${key} `)).map(line => Number(line.slice(key.length + 1)) || 1))

/** Whether `head`'s latest reported attempt passed (#419): a pass stops counting once a later attempt fails. */
export const reportedPassed = (reported: readonly string[], pr: number, head: string): boolean =>
  highestAttempt(reported, ciPassedKey(pr, head, 1)) > highestAttempt(reported, `pr-${pr} ci-failed ${head}`)

interface HeadRun {
  conclusion: string
  status: string
}

const FAILED = new Set(['FAILURE', 'ERROR', 'TIMED_OUT', 'CANCELLED', 'STARTUP_FAILURE', 'ACTION_REQUIRED'])
const DONE = new Set(['SUCCESS', 'SKIPPED', 'NEUTRAL'])

const NO_RESULT = new Set(['neutral', 'skipped'])

/** Whether GitHub has finished every check without a failing result. */
export const checksPassed = (checks: string[]): boolean => checks.every(check => DONE.has(check))

/** What WORKFLOW's run on the head says on its own: none, or one that ran nothing, reports no result. */
const headRunState = (run: HeadRun | null) => {
  if (!run) {
    return 'not reported'
  }
  if (run.status !== 'completed') {
    return 'running'
  }
  if (run.conclusion === 'success') {
    return 'green'
  }
  return NO_RESULT.has(run.conclusion) ? 'not reported' : 'failed'
}

/**
 * Failed as soon as any check did. Green only once WORKFLOW's run on the head passed and nothing else
 * still runs (#342): the rollup holds other apps' checks too, so on its own a lone skipped or passed
 * one, or no check at all, read as green before CI had reported.
 */
export const ciState = ({ checks, headRun }: { checks: string[], headRun: HeadRun | null }) => {
  if (checks.some(check => FAILED.has(check))) {
    return 'failed'
  }
  const state = headRunState(headRun)
  return state === 'green' && !checksPassed(checks) ? 'running' : state
}
