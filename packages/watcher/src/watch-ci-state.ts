/** What a PR's CI comes to, for the open-PR list and its reminders (watch-events.ts), and NOT_QUEUED (watch-queue-events.ts). */

/** A passed run's report line (#401): a later attempt has its own, so a rerun that passes reports too. */
export const ciPassedKey = (pr: number, sha: string, attempt: number): string => {
  const key = `pr-${pr} ci-passed ${sha}`
  return attempt > 1 ? `${key} ${attempt}` : key
}

/** The highest attempt reported under `key` and its line: a line without a number is attempt 1, none at all attempt 0. */
const latestAttempt = (reported: readonly string[], key: string): { attempt: number, index: number } =>
  reported.reduce((latest, line, index) => {
    const attempt = line === key || line.startsWith(`${key} `) ? Number(line.slice(key.length + 1)) || 1 : 0
    return attempt > 0 && attempt >= latest.attempt ? { attempt, index } : latest
  }, { attempt: 0, index: -1 })

/**
 * Whether `head`'s latest reported result passed (#419): a pass stops counting once a later attempt fails.
 * Attempts only order one run's results, and a new run on the head starts again at 1, so on a tie the later line wins (#430).
 */
export const reportedPassed = (reported: readonly string[], pr: number, head: string): boolean => {
  const pass = latestAttempt(reported, ciPassedKey(pr, head, 1))
  const fail = latestAttempt(reported, `pr-${pr} ci-failed ${head}`)
  return pass.attempt === fail.attempt ? pass.index > fail.index : pass.attempt > fail.attempt
}

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
