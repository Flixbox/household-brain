/* oxlint-disable import/no-nodejs-modules -- a temporary cache file for each test; node:fs/promises and node:os are built into Bun */
import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { type Asked, type Usage, afterAsking, backoffMs, cacheFrom, nextAskAt, readUsage, usageText, weekReset } from './claude-usage'

const ANSWER = { five_hour: { utilization: 31 }, seven_day: { resets_at: '2026-10-26T09:00:00Z', utilization: 40 } }
const OK: Asked = { body: ANSWER, retryAfter: null, status: 200 }
const LIMITED: Asked = { body: null, retryAfter: null, status: 429 }
const MINUTE = 60_000
const NOON = Temporal.Instant.from('2026-10-22T12:04:00Z').epochMilliseconds
const NEVER_READ = cacheFrom(null)

const dirs: string[] = []
afterEach(async () => {
  await Promise.all(dirs.splice(0).map(async dir => rm(dir, { force: true, recursive: true })))
})

const cacheFile = async () => {
  const dir = await mkdtemp(`${tmpdir()}/claude-usage-`)
  dirs.push(dir)
  return `${dir}/state/claude-usage.json`
}

/** An endpoint that answers `answers` in turn (the last one from then on), counting its asks. */
const endpoint = (answers: readonly Asked[], delayMs = 0) => {
  const asked = { count: 0 }
  const ask = async (): Promise<Asked> => {
    const answer = answers[Math.min(asked.count, answers.length - 1)] ?? null
    asked.count += 1
    await Bun.sleep(delayMs)
    return answer
  }
  return { ask, asked }
}

describe('afterAsking (#260)', () => {
  it('keeps a new answer and forgets earlier failures', () => {
    const failing: Usage = { ...NEVER_READ, failures: 3, retryAt: NOON }
    expect(afterAsking(failing, OK, NOON)).toEqual({ answer: ANSWER, answeredAt: NOON, askedAt: NOON, failures: 0, retryAt: 0 })
  })

  it('honours Retry-After, keeping the last answer', () => {
    const known = afterAsking(NEVER_READ, OK, NOON)
    const limited = afterAsking(known, { ...LIMITED, retryAfter: '120' }, NOON + MINUTE)
    expect(limited).toEqual({ answer: ANSWER, answeredAt: NOON, askedAt: NOON + MINUTE, failures: 1, retryAt: NOON + 3 * MINUTE })
  })

  it('backs off 1, 2, 4 … minutes, up to half an hour, also when Retry-After is shorter', () => {
    expect([1, 2, 3, 4, 5, 6, 10].map(failures => backoffMs(failures))).toEqual([1, 2, 4, 8, 16, 30, 30].map(minutes => minutes * MINUTE))
    const twice = afterAsking(afterAsking(NEVER_READ, LIMITED, NOON), null, NOON + MINUTE)
    expect(twice.failures).toBe(2)
    expect(twice.retryAt).toBe(NOON + 3 * MINUTE)
    // A date in Retry-After isn't read: the backoff applies.
    expect(afterAsking(NEVER_READ, { ...LIMITED, retryAfter: 'Thu, 22 Oct 2026 12:10:00 GMT' }, NOON).retryAt).toBe(NOON + MINUTE)
    expect(afterAsking(twice, { ...LIMITED, retryAfter: '0' }, NOON + 3 * MINUTE).retryAt).toBe(NOON + 7 * MINUTE)
  })

  it('asks again a minute after the last ask at the earliest', () => {
    expect(nextAskAt(afterAsking(NEVER_READ, OK, NOON))).toBe(NOON + MINUTE)
    expect(nextAskAt(afterAsking(NEVER_READ, { ...LIMITED, retryAfter: '5' }, NOON))).toBe(NOON + MINUTE)
    expect(nextAskAt(NEVER_READ)).toBe(MINUTE)
  })
})

describe('cacheFrom (#260)', () => {
  it('reads anything unreadable as never read', () => {
    expect(cacheFrom('garbage')).toEqual(NEVER_READ)
    expect(cacheFrom({ askedAt: 'soon', failures: null })).toEqual(NEVER_READ)
  })
})

describe('usageText (#260)', () => {
  const known = afterAsking(NEVER_READ, OK, NOON)

  it('is unknown only when nothing was ever read', () => {
    expect(usageText(NEVER_READ, NOON, 'UTC')).toBe('Usage: unknown')
    expect(usageText(afterAsking(NEVER_READ, LIMITED, NOON), NOON + 10 * MINUTE, 'UTC')).toBe('Usage: unknown')
  })

  it('marks numbers a minute old or more with when they were read', () => {
    expect(usageText(known, NOON + 59_000, 'UTC')).toBe('Usage: session 31% used (69% left), week 40% used (60% left, resets 2026-10-26 09:00)')
    expect(usageText(known, NOON + 5 * MINUTE, 'UTC')).toBe('Usage: session 31% used (69% left), week 40% used (60% left, resets 2026-10-26 09:00) (as of 12:04)')
    expect(usageText(known, NOON + 24 * 60 * MINUTE, 'UTC')).toEndWith('(as of 2026-10-22 12:04)')
  })

  it('gives the week reset as the endpoint does', () => {
    expect(weekReset(known)).toBe('2026-10-26T09:00:00Z')
    expect(weekReset(NEVER_READ)).toBe('unknown')
  })
})

describe('readUsage (#260)', () => {
  it('asks once a minute at most, answering from the cache meanwhile', async () => {
    const file = await cacheFile()
    const { ask, asked } = endpoint([OK])
    const first = await readUsage({ ask, file })
    const second = await readUsage({ ask, file })
    expect(asked.count).toBe(1)
    expect(second).toEqual(first)
    expect(first.answer).toEqual(ANSWER)
  })

  it('lets callers at once wait for the one ask in flight', async () => {
    const file = await cacheFile()
    const { ask, asked } = endpoint([OK], 500)
    const answers = await Promise.all(Array.from({ length: 5 }, async () => readUsage({ ask, file })))
    expect(asked.count).toBe(1)
    expect(answers.map(usage => usage.answer)).toEqual(Array.from({ length: 5 }, () => ANSWER))
  })

  it('keeps the backoff in the cache, so no caller asks before it ends', async () => {
    const file = await cacheFile()
    const { ask, asked } = endpoint([{ ...LIMITED, retryAfter: '600' }])
    await readUsage({ ask, file })
    const cached = cacheFrom(await Bun.file(file).json())
    expect(cached.failures).toBe(1)
    expect(cached.retryAt).toBeGreaterThan(Temporal.Now.instant().epochMilliseconds + 9 * MINUTE)
    await readUsage({ ask, file })
    expect(asked.count).toBe(1)
  })

  it('serves the last numbers known while the endpoint refuses', async () => {
    const file = await cacheFile()
    const old = afterAsking(NEVER_READ, OK, Temporal.Now.instant().epochMilliseconds - 10 * MINUTE)
    await Bun.write(file, JSON.stringify(old))
    const { ask, asked } = endpoint([LIMITED])
    const usage = await readUsage({ ask, file })
    expect(asked.count).toBe(1)
    expect(usage.answer).toEqual(ANSWER)
    expect(usage.answeredAt).toBe(old.answeredAt)
    expect(usageText(usage)).toContain('(as of ')
  })
})
