/* oxlint-disable import/no-nodejs-modules -- Bun has no rename of its own; node:fs/promises is built into Bun */
/**
 * The owner's Claude usage (#233, #260): the five-hour and seven-day windows that Claude Code's
 * `/usage` command shows, from the endpoint it asks (`/api/oauth/usage`) with the Claude login's OAuth
 * token. The token goes to that endpoint only, and is never printed, logged or stored.
 *
 * Every reader on this machine shares one cache, `$XDG_STATE_HOME/claude-usage.json` (or
 * `CLAUDE_USAGE_CACHE`): the watcher closes its notifications with it (when due, watch-usage.ts), and
 * agents run this file as the `claude-usage` command. Several agents asking at once had the endpoint
 * answer 429, so:
 *
 * - **Debounce:** the endpoint is asked at most once a minute; until then the cache answers.
 * - **One at a time:** the caller asking holds a local port as its lock (like the watcher's, #245),
 *   freed however it ends; the others wait for its answer instead of asking too.
 * - **Backoff:** after a 429 or any failure, the next ask waits 1, 2, 4 … minutes up to half an hour,
 *   or longer if `Retry-After` says so, kept in the cache so every caller respects it.
 * - **Stale but known:** meanwhile the last numbers read are served, marked with their time
 *   (`(as of 12:04)`); "unknown" only when nothing was ever read.
 *
 * Run as a command it prints the usage line, and with `--reset` the week's reset time (the endpoint's
 * ISO time, or `unknown`) on a second line.
 */
import { rename } from 'node:fs/promises'
import { ignoreFailure, isRecord } from './read'
import { UNKNOWN_USAGE, usageFrom } from './watch-events'

const home = process.env.HOME ?? process.env.USERPROFILE ?? '.'
const CONFIG = process.env.CLAUDE_CONFIG_DIR ?? `${home}/.claude`
const stateHome = process.env.XDG_STATE_HOME ?? `${home}/.local/state`
const CACHE_FILE = process.env.CLAUDE_USAGE_CACHE ?? `${stateHome}/claude-usage.json`
const ENDPOINT = 'https://api.anthropic.com/api/oauth/usage'
const MINUTE_MS = 60_000
const LONGEST_BACKOFF_MS = 30 * MINUTE_MS
// How long a caller waits for another's answer before it serves the cache as it is: longer than an ask may take.
const LONGEST_WAIT_MS = 20_000
const WAIT_STEP_MS = 250

/** What the cache keeps: the last answer read and when, and when to ask next. Times in epoch milliseconds. */
export interface Usage {
  answer: unknown
  answeredAt: number | null
  askedAt: number
  failures: number
  retryAt: number
}

/** One ask of the endpoint: its status, `Retry-After` and body; null when it couldn't be asked at all. */
export type Asked = { body: unknown, retryAfter: string | null, status: number } | null

const NEVER_READ: Usage = { answer: null, answeredAt: null, askedAt: 0, failures: 0, retryAt: 0 }

const numberOr = (value: unknown, fallback: number): number => (typeof value === 'number' && Number.isFinite(value) ? value : fallback)

/** The cache from its file's JSON; anything unreadable counts as never read. */
export const cacheFrom = (value: unknown): Usage => {
  if (!isRecord(value)) {
    return NEVER_READ
  }
  return {
    answer: value.answer ?? null,
    answeredAt: typeof value.answeredAt === 'number' ? value.answeredAt : null,
    askedAt: numberOr(value.askedAt, 0),
    failures: numberOr(value.failures, 0),
    retryAt: numberOr(value.retryAt, 0),
  }
}

/** When the endpoint may be asked again: a minute after the last ask, and not before the backoff ends. */
export const nextAskAt = (usage: Usage): number => Math.max(usage.askedAt + MINUTE_MS, usage.retryAt)

/** The wait after the n-th failure in a row: 1, 2, 4 … minutes, at most half an hour. */
export const backoffMs = (failures: number): number => Math.min(MINUTE_MS * 2 ** Math.max(0, failures - 1), LONGEST_BACKOFF_MS)

/** `Retry-After` in milliseconds; null when missing or a date (only the backoff applies then). */
const retryAfterMs = (header: string | null): number | null => {
  const seconds = header === null || header.trim() === '' ? Number.NaN : Number(header)
  return Number.isInteger(seconds) && seconds >= 0 ? seconds * 1000 : null
}

/** The cache after an ask at `now`: the new answer, or the old one kept with the next wait. */
export const afterAsking = (usage: Usage, asked: Asked, now: number): Usage => {
  if (asked?.status === 200 && isRecord(asked.body)) {
    return { answer: asked.body, answeredAt: now, askedAt: now, failures: 0, retryAt: 0 }
  }
  const failures = usage.failures + 1
  // The endpoint has answered 429 with `Retry-After: 0`: it is a floor, never shorter than the backoff.
  return { ...usage, askedAt: now, failures, retryAt: now + Math.max(retryAfterMs(asked?.retryAfter ?? null) ?? 0, backoffMs(failures)) }
}

const accessToken = async (): Promise<string | null> => {
  const credentials: unknown = await Bun.file(`${CONFIG}/.credentials.json`).json().catch(() => null)
  const oauth = isRecord(credentials) && isRecord(credentials.claudeAiOauth) ? credentials.claudeAiOauth : null
  return typeof oauth?.accessToken === 'string' ? oauth.accessToken : null
}

const askEndpoint = async (): Promise<Asked> => {
  const token = await accessToken()
  if (token === null) {
    return null
  }
  try {
    const response = await fetch(ENDPOINT, {
      headers: { 'anthropic-beta': 'oauth-2025-04-20', 'authorization': `Bearer ${token}` },
      signal: AbortSignal.timeout(10_000),
    })
    const body: unknown = response.ok ? await response.json() : null
    return { body, retryAfter: response.headers.get('retry-after'), status: response.status }
  } catch {
    // Unreachable, timed out, or not JSON: a failure like any other, backed off.
    return null
  }
}

const readCache = async (file: string): Promise<Usage> => cacheFrom(await Bun.file(file).json().catch(() => null))

/** Written to a temporary file and renamed over the old one, so no reader sees half a cache. */
const writeCache = async (file: string, usage: Usage): Promise<void> => {
  const draft = `${file}.${process.pid}.writing`
  await Bun.write(draft, `${JSON.stringify(usage)}\n`)
  await rename(draft, file)
}

/** The lock: a listening port only one process (and one caller in it) can hold; null when taken. */
const takeLock = (port: number): (() => void) | null => {
  try {
    const listener = Bun.listen({ exclusive: true, hostname: '127.0.0.1', port, socket: { data: ignoreFailure, open: socket => { socket.end() } } })
    listener.unref()
    return () => { listener.stop(true) }
  } catch {
    return null
  }
}

const now = (): number => Temporal.Now.instant().epochMilliseconds

interface Options {
  ask?: () => Promise<Asked>
  file?: string
}

/** Asks the endpoint, holding the lock, unless the caller before has answered since; keeps the outcome. */
const askHolding = async (release: () => void, ask: () => Promise<Asked>, file: string): Promise<Usage> => {
  try {
    // The caller before may have answered between the caller's first read and the lock.
    const current = await readCache(file)
    if (now() < nextAskAt(current)) {
      return current
    }
    const next = afterAsking(current, await ask(), now())
    // Not kept: the next caller asks again, which is all a lost write costs.
    await writeCache(file, next).catch(ignoreFailure)
    return next
  } finally {
    release()
  }
}

/**
 * The usage, asked again only when the cache allows it. Never fails: anything going wrong leaves the
 * last numbers known, or none.
 */
export const readUsage = async ({ ask = askEndpoint, file = CACHE_FILE }: Options = {}, waitedMs = 0): Promise<Usage> => {
  const cached = await readCache(file)
  if (now() < nextAskAt(cached) || waitedMs >= LONGEST_WAIT_MS) {
    return cached
  }
  // CLAUDE_USAGE_LOCK_PORT: set it only if another program listens on the port picked from the cache's path.
  const release = takeLock(Number(process.env.CLAUDE_USAGE_LOCK_PORT ?? 10_000 + (Bun.hash.crc32(file) % 10_000)))
  if (release !== null) {
    return askHolding(release, ask, file)
  }
  // Another caller is asking: wait for its answer instead of asking too.
  await Bun.sleep(WAIT_STEP_MS)
  return readUsage({ ask, file }, waitedMs + WAIT_STEP_MS)
}

/** When the numbers were read: the time today, else the date and time, on this machine's clock. */
const asOf = (at: number, today: number, timeZone: string): string => {
  const then = Temporal.Instant.fromEpochMilliseconds(at).toZonedDateTimeISO(timeZone)
  const sameDay = then.toPlainDate().equals(Temporal.Instant.fromEpochMilliseconds(today).toZonedDateTimeISO(timeZone).toPlainDate())
  return sameDay ? then.toPlainTime().toString({ smallestUnit: 'minute' }) : then.toPlainDateTime().toString({ smallestUnit: 'minute' }).replace('T', ' ')
}

/** The usage line; numbers a minute old or more (the endpoint refused since) end with when they were read. */
export const usageText = (usage: Usage, at = now(), timeZone = Temporal.Now.timeZoneId()): string => {
  const line = usageFrom(usage.answer, timeZone)
  return line === UNKNOWN_USAGE || usage.answeredAt === null || at - usage.answeredAt < MINUTE_MS
    ? line
    : `${line} (as of ${asOf(usage.answeredAt, at, timeZone)})`
}

/** The week's reset time as the endpoint gives it (ISO), or `unknown`. */
export const weekReset = (usage: Usage): string =>
  (isRecord(usage.answer) && isRecord(usage.answer.seven_day) && typeof usage.answer.seven_day.resets_at === 'string' ? usage.answer.seven_day.resets_at : 'unknown')

if (import.meta.main) {
  const usage = await readUsage()
  const lines = [usageText(usage), ...(process.argv.includes('--reset') ? [weekReset(usage)] : [])]
  process.stdout.write(`${lines.join('\n')}\n`)
}
