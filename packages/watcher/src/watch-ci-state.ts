/** What a PR's CI comes to, for the open-PR list and its reminders (watch-events.ts). */

const FAILED = new Set(['FAILURE', 'ERROR', 'TIMED_OUT', 'CANCELLED', 'STARTUP_FAILURE', 'ACTION_REQUIRED'])
const DONE = new Set(['SUCCESS', 'SKIPPED', 'NEUTRAL'])

export const ciState = (checks: string[]) => {
  if (checks.some(check => FAILED.has(check))) {
    return 'failed'
  }
  return checks.every(check => DONE.has(check)) ? 'green' : 'running'
}
