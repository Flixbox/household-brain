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
const GH_PARALLEL = Number(process.env.GH_PARALLEL ?? 4)
// Anything but a whole number from 1 would either never let a call through or never hold one back.
if (!Number.isInteger(GH_PARALLEL) || GH_PARALLEL < 1) {
  process.stderr.write('GH_PARALLEL must be a whole number from 1\n')
  process.exit(64)
}
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

/**
 * How the `gh` calls have gone (#253): when one last succeeded (the start counts as one), why the
 * latest failed, and whether LOOKUPS_FAILING was printed. Every caller treats a failed call as
 * "try again next look", so without this a watcher whose calls all fail would just go quiet.
 */
export const lookups = { failing: false, lastFailure: '', lastSuccess: Temporal.Now.instant() }

/** After this long without a single call succeeding, the watcher says so. */
const FAILING_AFTER = Temporal.Duration.from({ minutes: 5 })

/**
 * The line to print about the calls this look, or null, and whether they count as failing now:
 * LOOKUPS_FAILING on every look while none has succeeded for a while, LOOKUPS_RECOVERED once.
 */
export const lookupNews = (health: Readonly<typeof lookups>, now: Temporal.Instant, since: string): { failing: boolean, line: string | null } => {
  const failing = Temporal.Instant.compare(now, health.lastSuccess.add(FAILING_AFTER)) > 0
  if (failing) {
    return { failing, line: `LOOKUPS_FAILING: no gh call has succeeded since ${since} (the latest: ${health.lastFailure || 'no answer'}); nothing can be reported until one does` }
  }
  return { failing, line: health.failing ? 'LOOKUPS_RECOVERED: gh calls succeed again' : null }
}

/** What a `gh` call prints; it fails on a non-zero exit, or when it runs out of time. */
/** Starts a call; one that can't even start (no such program) counts as a failed call too. */
const started = (args: string[], cli: string) => {
  try {
    return Bun.spawn([cli, ...args], { killSignal: 'SIGKILL', stderr: 'ignore', stdout: 'pipe', timeout: GH_TIMEOUT_MS })
  } catch (error) {
    lookups.lastFailure = `${cli} couldn't be started`
    throw error
  }
}

const ghCall = async (args: string[], cli: string): Promise<string> => {
  const call = started(args, cli)
  // Read while it runs (a full pipe would stall it), but don't wait for the end of the output once it
  // failed: a wrapper script's child (`agent-gh` runs `gh`) can outlive it and hold the pipe open.
  const output = new Response(call.stdout).text()
  const exitCode = await call.exited
  if (exitCode !== 0) {
    output.catch(ignoreFailure)
    const why = call.signalCode === 'SIGKILL' ? `timed out after ${GH_TIMEOUT_MS / 1000} s` : `exit ${exitCode}`
    lookups.lastFailure = why
    throw new Error(`${cli} ${args.join(' ')}: ${why}`)
  }
  lookups.lastSuccess = Temporal.Now.instant()
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
