/** How the project watcher runs `gh` (watch-github.ts asks it everything): with a time limit, and only so many at once. */
import { ignoreFailure } from './read'

// GH: the `gh` to ask with, e.g. a wrapper logged in as a bot (GH=agent-gh). Defaults to plain gh.
export const GH = process.env.GH ?? 'gh'
// GH_TIMEOUT_SECONDS: how long one `gh` call may take (#228). A slow GitHub once held a whole look,
// and every event behind it, for minutes: a call that runs out fails like any failed read (the caller
// treats it as unknown and tries again next look), and the other calls' events still come out.
const GH_TIMEOUT_MS = Number(process.env.GH_TIMEOUT_SECONDS ?? 30) * 1000

// GH_PARALLEL: how many `gh` calls run at once (#240), 4 by default. The pollers and pull requests
// are checked in parallel, so one slow call holds back only its own check; the cap keeps the bursts
// within GitHub's rate limits.
const GH_PARALLEL = Math.max(1, Number(process.env.GH_PARALLEL ?? 4))
const slots = { free: GH_PARALLEL, waiting: new Array<() => void>() }

/** Waits for one of the GH_PARALLEL places; `release` hands it to the next waiting call. */
const take = async (): Promise<void> => {
  if (slots.free > 0) {
    slots.free -= 1
    return
  }
  await new Promise<void>(resolve => { slots.waiting.push(resolve) })
}
const release = () => {
  const next = slots.waiting.shift()
  if (next) {
    next()
    return
  }
  slots.free += 1
}

/** What a `gh` call prints; it fails on a non-zero exit, or when it runs out of time. */
const ghCall = async (args: string[], cli: string): Promise<string> => {
  const call = Bun.spawn([cli, ...args], { killSignal: 'SIGKILL', stderr: 'ignore', stdout: 'pipe', timeout: GH_TIMEOUT_MS })
  // Read while it runs (a full pipe would stall it), but don't wait for the end of the output once it
  // failed: a wrapper script's child (`agent-gh` runs `gh`) can outlive it and hold the pipe open.
  const output = new Response(call.stdout).text()
  const exitCode = await call.exited
  if (exitCode !== 0) {
    output.catch(ignoreFailure)
    const why = call.signalCode === 'SIGKILL' ? `timed out after ${GH_TIMEOUT_MS / 1000} s` : `exit ${exitCode}`
    throw new Error(`${cli} ${args.join(' ')}: ${why}`)
  }
  return output
}

export const ghText = async (args: string[], cli = GH): Promise<string> => {
  await take()
  try {
    return await ghCall(args, cli)
  } finally {
    release()
  }
}
