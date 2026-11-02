/** What a PR's CI comes to, for the open-PR list and its reminders (watch-events.ts). */

interface HeadRun {
  conclusion: string
  status: string
}

const FAILED = new Set(['FAILURE', 'ERROR', 'TIMED_OUT', 'CANCELLED', 'STARTUP_FAILURE', 'ACTION_REQUIRED'])
const DONE = new Set(['SUCCESS', 'SKIPPED', 'NEUTRAL'])

const NO_RESULT = new Set(['neutral', 'skipped'])

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
  return state === 'green' && !checks.every(check => DONE.has(check)) ? 'running' : state
}
