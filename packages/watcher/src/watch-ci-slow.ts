/** What `CI_SLOW` and `MAIN_SLOW` tell the agent to do about a run past its limit (pure, so it is tested). */
/** Publishing jobs by their name: `deploy` anywhere in it, or exactly `pages` or `dev-release` (`Build pages` builds). */
const DEPLOY_JOB = /\bdeploy\w*\b|^pages$|^dev-release$/iu

/** The names in `jobLines`' lines of the jobs not finished yet. */
const pendingJobs = (jobs: readonly string[]): string[] => jobs
  .filter(line => !/: completed \S*$/u.test(line))
  .map(line => line.replace(/: \S+ \S*$/u, '').trim())

/** Cancelling helps a hang, but only interrupts a deploy that takes its time (#551). */
export const slowAdvice = (jobs: readonly string[]): string => {
  const pending = pendingJobs(jobs)
  return pending.length > 0 && pending.every(name => DEPLOY_JOB.test(name))
    ? `Only deploy jobs are still pending (${pending.join(', ')}): leave it running.`
    : 'Cancel it and read the logs.'
}
