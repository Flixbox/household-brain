/** Antigravity windows normalized to the watcher's shared session/week format (#594). */
import type { Asked } from './claude-usage'
import { isRecord } from './read'

const resetTime = (value: unknown): string | null => {
  if (typeof value !== 'string') {
    return null
  }
  try {
    return Temporal.Instant.from(value).toString()
  } catch {
    return null
  }
}

const bucketWindow = (buckets: readonly unknown[], window: string): unknown => {
  const bucket = buckets.find(entry => isRecord(entry) && entry.window === window)
  if (!isRecord(bucket) || typeof bucket.remaining_fraction !== 'number'
    || !Number.isFinite(bucket.remaining_fraction) || bucket.remaining_fraction < 0 || bucket.remaining_fraction > 1) {
    return null
  }
  const reset = resetTime(bucket.reset_time)
  return reset === null ? null : { resets_at: reset, utilization: (1 - bucket.remaining_fraction) * 100 }
}

const geminiBuckets = (response: unknown): readonly unknown[] | null => {
  if (!isRecord(response) || response.status !== 'SUCCESS' || !isRecord(response.command)
    || response.command.name !== 'usage' || !isRecord(response.command.data)
    || !Array.isArray(response.command.data.groups)) {
    return null
  }
  const group = response.command.data.groups.find(entry => isRecord(entry) && entry.name === 'Gemini Models')
  return isRecord(group) && Array.isArray(group.buckets) ? group.buckets : null
}

/** Parse `agy -p /usage --output-format json` into the shared session/week window shape. */
export const antigravityAnswer = (response: unknown): unknown => {
  const buckets = geminiBuckets(response)
  if (buckets === null) {
    return null
  }
  const session = bucketWindow(buckets, '5h')
  const week = bucketWindow(buckets, 'weekly')
  return session === null && week === null ? null : { five_hour: session, seven_day: week }
}

/** An unsuccessful read keeps the last Antigravity answer through the shared cache's backoff. */
export const askAntigravity = async (): Promise<Asked> => {
  try {
    const run = Bun.spawn(['agy', '-p', '/usage', '--output-format', 'json', '--print-timeout', '15s'], {
      stderr: 'ignore',
      stdout: 'pipe',
      timeout: 20_000,
    })
    const [stdout, exitCode] = await Promise.all([new Response(run.stdout).text(), run.exited])
    if (exitCode !== 0) {
      return null
    }
    const parsed: unknown = JSON.parse(stdout)
    const body = antigravityAnswer(parsed)
    return body === null ? null : { body, retryAfter: null, status: 200 }
  } catch {
    return null
  }
}
