/** What a PR's CI comes to, for the open-PR list and its reminders (watch-events.ts). */

const FAILED = new Set(['FAILURE', 'ERROR', 'TIMED_OUT', 'CANCELLED', 'STARTUP_FAILURE', 'ACTION_REQUIRED'])
const DONE = new Set(['SUCCESS', 'SKIPPED', 'NEUTRAL'])

/**
 * Failed as soon as any check did. Green only once WORKFLOW's run on the head passed and nothing else
 * still runs (#342): the rollup holds other apps' checks too, so on its own a lone skipped or passed
 * one, or no check at all, read as green before CI had reported.
 */
export const ciState = ({ checks, headRunPassed }: { checks: string[], headRunPassed: boolean }) => {
  if (checks.some(check => FAILED.has(check))) {
    return 'failed'
  }
  return headRunPassed && checks.every(check => DONE.has(check)) ? 'green' : 'running'
}
