/**
 * How the project watcher runs `gh` (watch-github.ts asks it everything): with a time limit, only so
 * many at once, and sharing each answer with the other watchers on this machine for a moment.
 */
import { WATCHERS_DIR, removeOlder, writeWhole } from './watch-files'
import { blockedUntil, noteLimits } from './watch-pace'
import { ignoreFailure, isRecord } from './read'

// GH: the `gh` to ask with, e.g. a wrapper logged in as a bot (GH=agent-gh). Defaults to plain gh.
export const GH = process.env.GH ?? 'gh'
// GH_TIMEOUT_SECONDS: how long one `gh` call may take (#228). A slow GitHub once held a whole look,
// and every event behind it, for minutes: a call that runs out fails like any failed read (the caller
// treats it as unknown and tries again next look), and the other calls' events still come out.
const GH_TIMEOUT_MS = Number(process.env.GH_TIMEOUT_SECONDS ?? 30) * 1000

// GH_PARALLEL: how many `gh` calls run at once (#240), 2 by default (#400: GitHub allows 100 at once
// across every watcher and agent of an installation). The pollers and pull requests are checked in
// parallel, so one slow call holds back only its own check; the cap keeps the bursts within GitHub's
// rate limits.
const GH_PARALLEL = Number(process.env.GH_PARALLEL ?? 2)
// Anything but a whole number from 1 would either never let a call through or never hold one back.
if (!Number.isInteger(GH_PARALLEL) || GH_PARALLEL < 1) {
  process.stderr.write('GH_PARALLEL must be a whole number from 1\n')
  process.exit(64)
}
// How long a failed call's answer is waited for, once the call has ended.
const ANSWER_WAIT_MS = 1000
const NOT_MODIFIED = 304
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
    // GH_DEBUG=api: `gh` logs each answer's headers to stderr, whichever command asked (#400).
    return Bun.spawn([cli, ...args], { env: { ...process.env, GH_DEBUG: 'api' }, killSignal: 'SIGKILL', stderr: 'pipe', stdout: 'pipe', timeout: GH_TIMEOUT_MS })
  } catch (error) {
    lookups.lastFailure = `${cli} couldn't be started`
    throw error
  }
}

/** The HTTP status in GitHub's answer to a refused call, as `gh api` prints it (`"status":"404"`, or the status line with `-i`); null without one. */
const statusOf = (answer: string): number | null => {
  const line = /^HTTP\/[\d.]+ (?<status>\d{3})/u.exec(answer)
  if (line) {
    return Number(line.groups?.status)
  }
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
  const status = statusOf(answer)
  // `gh` exits 1 on a 304 (#405), but GitHub answered: "not changed" is a lookup that worked.
  if (status === NOT_MODIFIED) {
    lookups.lastSuccess = Temporal.Now.instant()
  } else {
    lookups.lastFailure = why
  }
  return new Error(`${command}: ${why}`, { cause: { status } })
}

/** Passes a finished call's log on for pacing, not waiting long for it (see ghCall on a wrapper's child). */
const noted = async (cli: string, log: Promise<string>, failed: boolean): Promise<void> => {
  log.catch(ignoreFailure)
  const text = await Promise.race([log, Bun.sleep(ANSWER_WAIT_MS).then(() => '')]).catch(() => '')
  await noteLimits(cli, text, failed)
}

/** What a `gh` call prints; it fails on a non-zero exit, or when it runs out of time. */
const ghCall = async (args: string[], cli: string): Promise<string> => {
  const call = started(args, cli)
  // Read while it runs (a full pipe would stall it), but don't wait long for the end of the output
  // once it failed: a wrapper script's child (`agent-gh` runs `gh`) can outlive it and hold the pipe open.
  const output = new Response(call.stdout).text()
  const log = new Response(call.stderr).text()
  const exitCode = await call.exited
  await noted(cli, log, exitCode !== 0)
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

/** Refused and told to wait (#400): the call fails here, costing GitHub nothing, and the next look tries again. */
const refuseWhileLimited = async (cli: string): Promise<void> => {
  const until = await blockedUntil(cli)
  if (until) {
    lookups.lastFailure = `waiting for GitHub's rate limit until ${until.toString()}`
    throw new Error(`${cli}: ${lookups.lastFailure}`, { cause: { status: null } })
  }
}

const asked = async (args: string[], cli: string): Promise<string> => {
  await take()
  try {
    await refuseWhileLimited(cli)
    return await ghCall(args, cli)
  } finally {
    release()
  }
}

/** The answer shared under `key` within GH_SHARE_SECONDS, or what `ask` gets, kept for the others. */
const sharedOr = async ({ cli, fresh, key }: { cli: string, fresh: boolean, key: string[] }, ask: () => Promise<string>): Promise<string> => {
  if (fresh || SHARE_MS === 0) {
    return ask()
  }
  const path = answerFile(key, cli)
  const shared = await sharedAnswer(path)
  if (shared !== null) {
    lookups.lastSuccess = Temporal.Now.instant()
    return shared
  }
  const answer = await ask()
  // Sharing is only a saving: an answer that can't be kept is asked for again next time.
  await writeWhole(path, answer).catch(ignoreFailure)
  return answer
}

/**
 * What `gh` answers to `args`. Every question names its repository (all but the one that finds the
 * repository from the folder, which passes `fresh`), so a shared answer is never another's. `fresh`
 * also asks GitHub again for what has to be known now, not some seconds ago.
 */
export const ghText = async (args: string[], cli = GH, fresh = false): Promise<string> =>
  sharedOr({ cli, fresh, key: args }, async () => asked(args, cli))

// What GitHub answered to a REST read, with its ETag (#405): asked again with `If-None-Match`, an
// unchanged answer is a 304, which costs no rate limit. Kept longer than shared answers, since an
// ETag saves a call however old it is; one left unused for a day (a finished commit's runs) goes.
const ETAGS_DIR = `${WATCHERS_DIR}/gh-etags`
await removeOlder(ETAGS_DIR, Temporal.Duration.from({ hours: 24 }))

/**
 * Where a REST answer is kept: per URL and per token, as an ETag holds only for who it was given to.
 * `cli` stands for the token of a wrapper (`agent-gh`), the variables for plain `gh`'s. The name is
 * a SHA-256, so the token itself is never written down.
 */
const etagFile = (path: string, cli: string) => {
  const identity = JSON.stringify([cli, process.env.GH_TOKEN ?? '', process.env.GITHUB_TOKEN ?? '', path])
  return `${ETAGS_DIR}/${new Bun.CryptoHasher('sha256').update(identity).digest('hex')}`
}

/** The kept answer for an ETag file; null when there is none, or it can't be read. */
const keptAnswer = async (file: string): Promise<{ body: string, etag: string } | null> => {
  const value: unknown = await Bun.file(file).json().catch(() => null)
  return isRecord(value) && typeof value.body === 'string' && typeof value.etag === 'string' ? { body: value.body, etag: value.etag } : null
}

/** Keeps an answer, or marks a kept one as used. Only a saving, like sharing: without it the next read costs a call. */
const keepAnswer = async (file: string, answer: { body: string, etag: string }): Promise<void> =>
  writeWhole(file, JSON.stringify(answer)).catch(ignoreFailure)

/** Splits what `gh api -i` prints into the body and its ETag ('' without one). */
const parsedAnswer = (raw: string): { body: string, etag: string } => {
  const end = raw.indexOf('\r\n\r\n')
  if (end === -1) {
    throw new Error('gh api -i printed no headers')
  }
  const etag = /^etag: *(?<etag>\S.*)$/imu.exec(raw.slice(0, end))?.groups?.etag ?? ''
  return { body: raw.slice(end + 4), etag: etag.trim() }
}

/** Asks GitHub for `path`, with the kept ETag if there is one. `gh` exits 1 on a 304, so that failure is the good news. */
const revalidated = async (path: string, cli: string): Promise<string> => {
  const file = etagFile(path, cli)
  const kept = await keptAnswer(file)
  const condition = kept ? ['-H', `If-None-Match: ${kept.etag}`] : []
  const raw = await ghText(['api', '-i', ...condition, path], cli, true).catch((error: unknown) => {
    if (kept && failedStatus(error) === NOT_MODIFIED) {
      return null
    }
    throw error
  })
  if (raw === null && kept) {
    await keepAnswer(file, kept)
    return kept.body
  }
  const answer = parsedAnswer(raw ?? '')
  await (answer.etag ? keepAnswer(file, answer) : Promise.resolve())
  return answer.body
}

/** The JSON at the REST `path`, asked for with its ETag (#405); shared like any answer, and `fresh` skips that. */
export const ghRest = async (path: string, cli = GH, fresh = false): Promise<unknown> =>
  JSON.parse(await sharedOr({ cli, fresh, key: ['rest', etagFile(path, cli)] }, async () => revalidated(path, cli)))
