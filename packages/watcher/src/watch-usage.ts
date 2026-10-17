/**
 * The owner's Claude usage (#233): the five-hour and seven-day windows that Claude Code's `/usage`
 * command shows, printed with the watcher's events so an agent sees it on every one. It asks the same
 * endpoint `/usage` does (`/api/oauth/usage`) with the Claude login's OAuth token, at most once a
 * minute, also across restarts (the last answer is kept with the watcher's state); each window with
 * the time it resets, on this machine's clock. The token goes to that endpoint only, and is never
 * printed, logged or stored. Anything missing or failing reads "unknown"; a window the answer lacks, "?".
 */
import { ignoreFailure, isRecord } from './read'
import { readLines, writeLines } from './watch-state'

const CONFIG = process.env.CLAUDE_CONFIG_DIR ?? `${process.env.HOME ?? process.env.USERPROFILE ?? '.'}/.claude`
const ENDPOINT = 'https://api.anthropic.com/api/oauth/usage'
const UNKNOWN = 'Usage: unknown'
const ONCE_A_MINUTE_MS = 60_000

/** When a window resets, on this machine's clock (`2026-10-17 14:10`); null when it doesn't say. */
const resetTime = (resetsAt: unknown, timeZone: string): string | null => {
  try {
    return typeof resetsAt === 'string' ? Temporal.Instant.from(resetsAt).toZonedDateTimeISO(timeZone).toPlainDateTime().toString({ smallestUnit: 'minute' }).replace('T', ' ') : null
  } catch {
    return null
  }
}

/** A window's use as a whole percentage, and when it resets (the owner's request on #233). */
const windowUse = (window: unknown, timeZone: string): string => {
  if (!isRecord(window) || typeof window.utilization !== 'number') {
    return '?'
  }
  const reset = resetTime(window.resets_at, timeZone)
  const resets = reset === null ? '' : ` (resets ${reset})`
  return `${Math.round(window.utilization)}%${resets}`
}

/** The usage line from the endpoint's answer; "unknown" for anything that isn't one. */
export const usageFrom = (answer: unknown, timeZone = Temporal.Now.timeZoneId()): string =>
  (isRecord(answer) && (isRecord(answer.five_hour) || isRecord(answer.seven_day))
    ? `Usage: session ${windowUse(answer.five_hour, timeZone)}, week ${windowUse(answer.seven_day, timeZone)}`
    : UNKNOWN)

const accessToken = async (): Promise<string | null> => {
  const credentials: unknown = await Bun.file(`${CONFIG}/.credentials.json`).json().catch(() => null)
  const oauth = isRecord(credentials) && isRecord(credentials.claudeAiOauth) ? credentials.claudeAiOauth : null
  return typeof oauth?.accessToken === 'string' ? oauth.accessToken : null
}

const ask = async (): Promise<string> => {
  const token = await accessToken()
  if (token === null) {
    return UNKNOWN
  }
  const answer: unknown = await fetch(ENDPOINT, {
    headers: { 'anthropic-beta': 'oauth-2025-04-20', 'authorization': `Bearer ${token}` },
    signal: AbortSignal.timeout(10_000),
  }).then(async (response): Promise<unknown> => (response.ok ? response.json() : null)).catch(() => null)
  return usageFrom(answer)
}

/** The current usage line, asked again only when the last answer, kept in the `usage` state file, is a minute old. */
export const usageLine = async (): Promise<string> => {
  const now = Temporal.Now.instant().epochMilliseconds
  const [askedAt = '', line = UNKNOWN] = await readLines('usage').catch(() => [])
  if (now - Number(askedAt) < ONCE_A_MINUTE_MS) {
    return line
  }
  const fresh = await ask()
  // Not kept: the next look just asks again.
  await writeLines('usage', [String(now), fresh]).catch(ignoreFailure)
  return fresh
}
