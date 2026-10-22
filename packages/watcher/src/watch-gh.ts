/**
 * How the project watcher runs `gh` (watch-github.ts asks it everything): with a time limit, only so
 * many at once, and sharing each answer with the other watchers on this machine for a moment.
 */
import { WATCHERS_DIR, removeOlder, writeWhole } from './watch-files'
import { ignoreFailure, isRecord } from './read'

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
// How long a failed call's answer is waited for, once the call has ended.
const ANSWER_WAIT_MS = 1000
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

/** Starts a call; one that can't even start (no such program) counts as a failed call too. */
const started = (args: string[], cli: string) => {
  try {
    return Bun.spawn([cli, ...args], { killSignal: 'SIGKILL', stderr: 'ignore', stdout: 'pipe', timeout: GH_TIMEOUT_MS })
  } catch (error) {
    lookups.lastFailure = `${cli} couldn't be started`
    throw error
  }
}

/** The HTTP status in GitHub's answer to a refused call, as `gh api` prints it (`"status":"404"`); null without one. */
const statusOf = (answer: string): number | null => {
  try {
    const value: unknown = JSON.parse(answer)
    const status = isRecord(value) ? Number(value.status) : Number.NaN
    return Number.isInteger(status) && status > 0 ? status : null
  } catch {
    return null
  }
}

/**
 * The HTTP status GitHub refused a failed call with (#263), e.g. 404 for an issue that is gone; null
 * for a call that failed without an answer (it ran out of time, or `gh` itself failed).
 */
export const failedStatus = (error: unknown): number | null =>
  error instanceof Error && isRecord(error.cause) && typeof error.cause.status === 'number' ? error.cause.status : null

/** The error for a failed call, with the HTTP status GitHub refused it with, if it answered. */
const failure = async (command: string, call: ReturnType<typeof started>, output: Promise<string>): Promise<Error> => {
  const timedOut = call.signalCode === 'SIGKILL'
  // A refused call's answer says why (#263): `gh api` prints GitHub's error, with its HTTP status.
  const answer = timedOut ? '' : await Promise.race([output, Bun.sleep(ANSWER_WAIT_MS).then(() => '')])
  output.catch(ignoreFailure)
  const why = timedOut ? `timed out after ${GH_TIMEOUT_MS / 1000} s` : `exit ${call.exitCode}`
  lookups.lastFailure = why
  return new Error(`${command}: ${why}`, { cause: { status: statusOf(answer) } })
}

/** What a `gh` call prints; it fails on a non-zero exit, or when it runs out of time. */
const ghCall = async (args: string[], cli: string): Promise<string> => {
  const call = started(args, cli)
  // Read while it runs (a full pipe would stall it), but don't wait long for the end of the output
  // once it failed: a wrapper script's child (`agent-gh` runs `gh`) can outlive it and hold the pipe open.
  const output = new Response(call.stdout).text()
  const exitCode = await call.exited
  if (exitCode !== 0) {
    throw await failure(`${cli} ${args.join(' ')}`, call, output)
  }
  lookups.lastSuccess = Temporal.Now.instant()
  return output
}

// GH_SHARE_SECONDS: how long an answer is shared (#264), 20 by default, at most 3600; 0 shares none. Any number of
// watchers can watch one repository, and each asks the same questions: within this time, a question
// another watcher (or this one) just asked takes its answer instead of asking GitHub again, so
// several watchers cost GitHub hardly more than one. Under the time the answers poller pauses, so
// each look still sees a newer answer than the last.
const SHARE_MS = Number(process.env.GH_SHARE_SECONDS ?? 20) * 1000
if (!Number.isFinite(SHARE_MS) || SHARE_MS < 0 || SHARE_MS > 3_600_000) {
  process.stderr.write('GH_SHARE_SECONDS must be a number from 0 to 3600\n')
  process.exit(64)
}
const ANSWERS_DIR = `${WATCHERS_DIR}/gh-answers`
// Answers no longer shared (none is shared for longer than an hour) are only taking up room.
await removeOlder(ANSWERS_DIR, Temporal.Duration.from({ hours: 1 }))

/** Where an answer is kept: by the `gh` that answered and every argument, so no two questions meet. */
const answerFile = (args: readonly string[], cli: string) => `${ANSWERS_DIR}/${Bun.hash(JSON.stringify([cli, ...args])).toString(36)}`

/** An answer given within GH_SHARE_SECONDS; null when there is none (a missing file counts as old). */
const sharedAnswer = async (path: string): Promise<string | null> => {
  const file = Bun.file(path)
  const age = Temporal.Now.instant().epochMilliseconds - file.lastModified
  return age >= 0 && age < SHARE_MS ? file.text().catch(() => null) : null
}

const asked = async (args: string[], cli: string): Promise<string> => {
  await take()
  try {
    return await ghCall(args, cli)
  } finally {
    release()
  }
}

/**
 * What `gh` answers to `args`. Every question names its repository (all but the one that finds the
 * repository from the folder, which passes `fresh`), so a shared answer is never another's. `fresh`
 * also asks GitHub again for what has to be known now, not some seconds ago.
 */
export const ghText = async (args: string[], cli = GH, fresh = false): Promise<string> => {
  if (fresh || SHARE_MS === 0) {
    return asked(args, cli)
  }
  const path = answerFile(args, cli)
  const shared = await sharedAnswer(path)
  if (shared !== null) {
    lookups.lastSuccess = Temporal.Now.instant()
    return shared
  }
  const answer = await asked(args, cli)
  // Sharing is only a saving: an answer that can't be kept is asked for again next time.
  await writeWhole(path, answer).catch(ignoreFailure)
  return answer
}
