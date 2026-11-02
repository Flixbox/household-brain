/** Codex windows normalized to the watcher's shared session/week format (#338). */
import { type Asked } from './claude-usage'
import { codexRateLimits } from './codex-rpc'
import { isRecord } from './read'

const resetTime = (seconds: unknown): string | null => {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds)) {
    return null
  }
  try {
    return Temporal.Instant.fromEpochMilliseconds(seconds * 1000).toString()
  } catch {
    return null
  }
}

const windowFrom = (value: unknown, minutes: number): unknown => {
  if (!isRecord(value) || value.windowDurationMins !== minutes || typeof value.usedPercent !== 'number'
    || !Number.isFinite(value.usedPercent) || value.usedPercent < 0 || value.usedPercent > 100) {
    return null
  }
  const reset = resetTime(value.resetsAt)
  return reset === null ? null : { resets_at: reset, utilization: value.usedPercent }
}

/** Choose Codex's allowance rather than another model's limit; durations define the window names. */
export const codexAnswer = (response: unknown): unknown => {
  if (!isRecord(response)) {
    return null
  }
  const limits = isRecord(response.rateLimitsByLimitId) ? response.rateLimitsByLimitId.codex : response.rateLimits
  if (!isRecord(limits)) {
    return null
  }
  const session = windowFrom(limits.primary, 300) ?? windowFrom(limits.secondary, 300)
  const week = windowFrom(limits.primary, 10_080) ?? windowFrom(limits.secondary, 10_080)
  return session === null && week === null ? null : { five_hour: session, seven_day: week }
}

/** An unsuccessful read keeps the last Codex answer through the shared cache's backoff. */
export const askCodex = async (): Promise<Asked> => {
  try {
    const body = codexAnswer(await codexRateLimits())
    return body === null ? null : { body, retryAfter: null, status: 200 }
  } catch {
    return null
  }
}
