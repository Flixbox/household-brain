/**
 * The owner's Claude usage (#233), the five-hour and seven-day windows Claude Code's `/usage` shows,
 * printed with the watcher's events so an agent sees it on every one. It asks the endpoint `/usage`
 * itself asks, with the Claude login's OAuth token, at most once a minute. The token goes to that
 * endpoint only, and is never printed, logged or stored. Anything missing or failing reads "unknown".
 */
import { isRecord } from './read'

const CONFIG = process.env.CLAUDE_CONFIG_DIR ?? `${process.env.HOME ?? process.env.USERPROFILE ?? '.'}/.claude`
const ENDPOINT = 'https://api.anthropic.com/api/oauth/usage'
const UNKNOWN = 'Usage: unknown'
const ONCE_A_MINUTE_MS = 60_000

const percent = (window: unknown): string =>
  (isRecord(window) && typeof window.utilization === 'number' ? `${Math.round(window.utilization)}%` : '?')

/** The usage line from the endpoint's answer; "unknown" for anything that isn't one. */
export const usageFrom = (answer: unknown): string =>
  (isRecord(answer) && (isRecord(answer.five_hour) || isRecord(answer.seven_day)) ? `Usage: session ${percent(answer.five_hour)}, week ${percent(answer.seven_day)}` : UNKNOWN)

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

const last = { askedAt: Number.NEGATIVE_INFINITY, line: UNKNOWN }

/** The current usage line, asked again only when the last answer is a minute old. */
export const usageLine = async (): Promise<string> => {
  if (performance.now() - last.askedAt >= ONCE_A_MINUTE_MS) {
    last.askedAt = performance.now()
    last.line = await ask()
  }
  return last.line
}
