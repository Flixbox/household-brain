/**
 * How the commands agents run (`agent-queue`, `reply-review-thread`) run `gh`: with a time limit (#540),
 * as the watcher (#228) and issue-links do, so a hung `gh` can't hang the agent that ran them.
 */
import { ignoreFailure } from './read'

// AGENT_GH_TIMEOUT_SECONDS: how long one call may take. Not the watcher's GH_TIMEOUT_SECONDS: that one is
// 30 s for a poll that simply tries again, and reply-review-thread may read the watcher's settings file.
// Every call here is one short request: agent-queue only turns auto-merge on or asks for one merge and
// never waits for a merge queue, and its waits for a rate limit are sleeps between calls, outside this limit.
const LIMIT_SECONDS = Number(process.env.AGENT_GH_TIMEOUT_SECONDS ?? 120)
// 0 (a blank value reads as 0) would be no limit at all, and Bun.spawn refuses a fraction or a negative number.
if (!Number.isInteger(LIMIT_SECONDS) || LIMIT_SECONDS < 1 || LIMIT_SECONDS > 3600) {
  process.stderr.write('AGENT_GH_TIMEOUT_SECONDS must be a whole number from 1 to 3600\n')
  process.exit(64)
}

/**
 * What `gh` prints for `args`, and its exit code. A call that runs out of time throws, so no caller can
 * read its empty answer as one from GitHub. The output isn't waited for then: a wrapper's child can
 * outlive the killed wrapper and hold the pipe open.
 */
export const ghCall = async (gh: string, args: readonly string[], env: Record<string, string | undefined>): Promise<{ code: number, out: string }> => {
  const call = Bun.spawn([gh, ...args], { env, killSignal: 'SIGKILL', stderr: 'inherit', stdout: 'pipe', timeout: LIMIT_SECONDS * 1000 })
  const output = new Response(call.stdout).text()
  const code = await call.exited
  if (call.signalCode === 'SIGKILL') {
    output.catch(ignoreFailure)
    throw new Error(`${gh} ${args.slice(0, 3).join(' ')} ran out of time after ${LIMIT_SECONDS} s and was killed. There is no answer: a write may or may not have gone through, so check before trying again.`)
  }
  return { code, out: await output }
}
