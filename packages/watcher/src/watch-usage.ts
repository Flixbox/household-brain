/**
 * The owner's Claude usage (#233): the five-hour and seven-day windows that Claude Code's `/usage`
 * command shows, printed with the watcher's events so an agent sees it on every one. It asks the same
 * endpoint `/usage` does (`/api/oauth/usage`) with the Claude login's OAuth token, at most once a
 * minute, also across restarts (the last answer is kept with the watcher's state); each window with
 * the time it resets, on this machine's clock. The token goes to that endpoint only, and is never
 * printed, logged or stored. Anything missing or failing reads "unknown"; a window the answer lacks, "?".
 */
import { ignoreFailure, isRecord } from './read'
import { UNKNOWN_USAGE, usageFrom } from './watch-events'
import { readLines, writeLines } from './watch-state'

const CONFIG = process.env.CLAUDE_CONFIG_DIR ?? `${process.env.HOME ?? process.env.USERPROFILE ?? '.'}/.claude`
const ENDPOINT = 'https://api.anthropic.com/api/oauth/usage'
const ONCE_A_MINUTE_MS = 60_000

const accessToken = async (): Promise<string | null> => {
  const credentials: unknown = await Bun.file(`${CONFIG}/.credentials.json`).json().catch(() => null)
  const oauth = isRecord(credentials) && isRecord(credentials.claudeAiOauth) ? credentials.claudeAiOauth : null
  return typeof oauth?.accessToken === 'string' ? oauth.accessToken : null
}

const ask = async (): Promise<string> => {
  const token = await accessToken()
  if (token === null) {
    return UNKNOWN_USAGE
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
  const [askedAt = '', line = UNKNOWN_USAGE] = await readLines('usage').catch(() => [])
  if (now - Number(askedAt) < ONCE_A_MINUTE_MS) {
    return line
  }
  const fresh = await ask()
  // Not kept: the next look just asks again.
  await writeLines('usage', [String(now), fresh]).catch(ignoreFailure)
  return fresh
}
