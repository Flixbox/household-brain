/* oxlint-disable import/no-nodejs-modules -- a temporary folder holds the fake gh these tests run */
import { afterAll, describe, expect, it } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { type Limits, NO_LIMITS, blockedUntil, noteLimits, pauseMs, resourceOf, stretchFor, updatedLimits } from './watch-pace'
import { ghText } from './watch-gh'

const folder = await mkdtemp(`${tmpdir()}/watch-pace-`)
const NOW_MS = 1_800_000_000_000
const NOW_SECONDS = NOW_MS / 1000
const MARGIN_MS = 5000
const MINUTE_MS = 60_000

const answer = (status: string, ...headers: string[]) => [`< HTTP/2.0 ${status}`, ...headers.map(header => `< ${header}`), ''].join('\n')
const budgetHeaders = (remaining: number, resetSeconds: number, resource = 'graphql') => [
  'X-Ratelimit-Limit: 5000',
  `X-Ratelimit-Remaining: ${remaining}`,
  `X-Ratelimit-Reset: ${resetSeconds}`,
  `X-Ratelimit-Resource: ${resource}`,
]
const after = (log: string, failed = false, limits: Limits = NO_LIMITS) => updatedLimits(limits, log, { failed, nowMs: NOW_MS })

describe('updatedLimits (#400)', () => {
  it('reads the budget of each resource from the response headers, and nothing from a body', () => {
    const body = '{ "text": "< X-Ratelimit-Remaining: 0" }'
    const log = ['* Request at 19:23', answer('200 OK', ...budgetHeaders(4000, NOW_SECONDS + 1800)), body, answer('200 OK', ...budgetHeaders(900, NOW_SECONDS + 600, 'core'))].join('\n')
    expect(after(log)).toEqual({
      budgets: {
        core: { limit: 5000, remaining: 900, resetMs: NOW_MS + 600_000 },
        graphql: { limit: 5000, remaining: 4000, resetMs: NOW_MS + 1_800_000 },
      },
      waits: {},
    })
  })

  it('keeps the latest reset seen, because GitHub answers from split counters', () => {
    const earlier = after(answer('200 OK', ...budgetHeaders(100, NOW_SECONDS + 900)))
    expect(after(answer('200 OK', ...budgetHeaders(4000, NOW_SECONDS + 300)), false, earlier).budgets.graphql).toEqual({ limit: 5000, remaining: 4000, resetMs: NOW_MS + 900_000 })
  })

  it('forgets a reset that has passed', () => {
    const old = after(answer('200 OK', ...budgetHeaders(100, NOW_SECONDS - 10)))
    expect(after(answer('200 OK', ...budgetHeaders(4000, NOW_SECONDS + 300)), false, old).budgets.graphql?.resetMs).toBe(NOW_MS + 300_000)
  })

  it('waits for retry-after, plus a margin, after a refusal', () => {
    expect(after(answer('403 Forbidden', 'Retry-After: 120'), true).waits.all).toBe(NOW_MS + 120_000 + MARGIN_MS)
  })

  it('waits for the reset once the budget is used up', () => {
    expect(after(answer('403 Forbidden', ...budgetHeaders(0, NOW_SECONDS + 700)), true).waits.graphql).toBe(NOW_MS + 700_000 + MARGIN_MS)
  })

  it('waits a minute after a secondary limit that names no time', () => {
    const log = `${answer('403 Forbidden')}\n{ "message": "You have exceeded a secondary rate limit" }`
    expect(after(log, true).waits.all).toBe(NOW_MS + MINUTE_MS + MARGIN_MS)
  })

  it('waits a minute after a 429 that says nothing else', () => {
    expect(after(answer('429 Too Many Requests'), true).waits.all).toBe(NOW_MS + MINUTE_MS + MARGIN_MS)
  })

  it('keeps a secondary limit on every call, even with the budget at zero', () => {
    const log = `${answer('403 Forbidden', ...budgetHeaders(0, NOW_SECONDS + 700))}\n{ "message": "You have exceeded a secondary rate limit" }`
    expect(after(log, true).waits).toEqual({ all: NOW_MS + MINUTE_MS + MARGIN_MS })
  })

  it('keeps retry-after on its own resource when that budget ran out, and on every call when it did not', () => {
    const headers = (remaining: number) => answer('403 Forbidden', 'Retry-After: 120', ...budgetHeaders(remaining, NOW_SECONDS + 700))
    expect(after(headers(0), true).waits).toEqual({ graphql: NOW_MS + 120_000 + MARGIN_MS })
    expect(after(headers(4000), true).waits).toEqual({ all: NOW_MS + 120_000 + MARGIN_MS })
  })

  it('takes a 429 with budget left for a short limit, not the hourly reset', () => {
    expect(after(answer('429 Too Many Requests', ...budgetHeaders(4000, NOW_SECONDS + 700)), true).waits).toEqual({ all: NOW_MS + MINUTE_MS + MARGIN_MS })
  })

  it('waits for the reset after GraphQL refuses with budget left on the counter that answered', () => {
    const log = `${answer('200 OK', ...budgetHeaders(10, NOW_SECONDS + 400))}\n{ "errors": [{ "type": "RATE_LIMITED" }] }`
    expect(after(log, true).waits.graphql).toBe(NOW_MS + 400_000 + MARGIN_MS)
  })

  it('stops for a GraphQL refusal even when gh exits successfully, but not for a comment quoting one', () => {
    const budget = answer('200 OK', ...budgetHeaders(10, NOW_SECONDS + 400))
    expect(after(`${budget}\n{ "errors": [{ "type": "RATE_LIMITED" }] }`).waits.graphql).toBe(NOW_MS + 400_000 + MARGIN_MS)
    expect(after(`${budget}\n${JSON.stringify({ body: '"type": "RATE_LIMITED"' })}`).waits).toEqual({})
  })

  it('is not stopped by a 403 for another reason, or by a comment that talks about limits', () => {
    expect(after(`${answer('403 Forbidden')}\n{ "message": "Resource not accessible by integration" }`, true).waits).toEqual({})
    expect(after(`${answer('200 OK')}\n{ "body": "secondary rate limit" }`).waits).toEqual({})
    expect(after(`${answer('200 OK', ...budgetHeaders(10, NOW_SECONDS + 400))}\n{ "body": "a comment" }`, true).waits).toEqual({})
  })

  it('never waits for more than an hour, whatever a header says', () => {
    expect(after(answer('403 Forbidden', 'Retry-After: 999999'), true).waits.all).toBe(NOW_MS + 3_600_000 + MARGIN_MS)
  })

  it('keeps a later wait another watcher already wrote', () => {
    const blocked = { ...NO_LIMITS, waits: { all: NOW_MS + 900_000 } }
    expect(after(answer('403 Forbidden', 'Retry-After: 10'), true, blocked).waits.all).toBe(NOW_MS + 900_000)
  })
})

describe('stretchFor (#400)', () => {
  const left = (remaining: number, minutes: number): Limits => ({ budgets: { graphql: { limit: 5000, remaining, resetMs: NOW_MS + (minutes * MINUTE_MS) } }, waits: {} })

  it('leaves the pauses alone while the budget lasts', () => {
    expect(stretchFor(NO_LIMITS, NOW_MS)).toBe(1)
    expect(stretchFor(left(2500, 50), NOW_MS)).toBe(1)
  })

  it('stretches them when the budget left falls behind the time left', () => {
    expect(stretchFor(left(1500, 50), NOW_MS)).toBe(2)
    expect(stretchFor(left(500, 50), NOW_MS)).toBe(4)
  })

  it('leaves them alone when the reset is near enough for the budget to last', () => {
    expect(stretchFor(left(1500, 5), NOW_MS)).toBe(1)
    expect(stretchFor(left(500, -1), NOW_MS)).toBe(1)
  })

  it('goes by the tightest resource', () => {
    const limits = { budgets: { ...left(4000, 50).budgets, core: { limit: 5000, remaining: 100, resetMs: NOW_MS + (50 * MINUTE_MS) } }, waits: {} }
    expect(stretchFor(limits, NOW_MS)).toBe(4)
  })
})

describe('pauseMs (#400)', () => {
  const pause = (baseMs: number, quietLooks: number, { capMs = 300_000, stretch = 1 } = {}) => pauseMs({ baseMs, busy: false, capMs, quietLooks, stretch })

  it('backs off while nothing changes', () => {
    expect([1, 2, 3, 9].map(looks => pause(60_000, looks))).toEqual([60_000, 120_000, 300_000, 300_000])
    expect([1, 2, 3].map(looks => pause(30_000, looks, { capMs: 60_000 }))).toEqual([30_000, 60_000, 60_000])
  })

  it('keeps a minimum gap after a busy look', () => {
    expect(pauseMs({ baseMs: 60_000, busy: true, capMs: 300_000, quietLooks: 0, stretch: 1 })).toBe(10_000)
  })

  it('stretches quiet and busy pauses alike', () => {
    expect(pause(60_000, 1, { stretch: 2 })).toBe(120_000)
    expect(pauseMs({ baseMs: 60_000, busy: true, capMs: 300_000, quietLooks: 0, stretch: 4 })).toBe(40_000)
  })
})

describe('ghText and the limit (#400)', () => {
  afterAll(async () => rm(folder, { force: true, recursive: true }))
  const fakeGh = async (name: string, script: string) => {
    const path = `${folder}/${name}`
    await Bun.write(path, `#!/bin/sh\n${script}\n`)
    Bun.spawnSync(['chmod', '+x', path])
    return path
  }
  const linesOf = async (path: string) => (await Bun.file(path).text()).trim().split('\n')

  it('after a refusal asks GitHub no more until the wait is over, and shares that', async () => {
    const calls = `${folder}/refused-calls`
    const gh = await fakeGh('refused', `echo "$GH_DEBUG" >> ${calls}\necho '< HTTP/2.0 403 Forbidden' >&2\necho '< Retry-After: 120' >&2\nexit 1`)
    await expect(ghText(['one'], gh, true)).rejects.toThrow('exit 1')
    await expect(ghText(['two'], gh, true)).rejects.toThrow('rate limit')
    expect(await linesOf(calls)).toEqual(['api'])
  })

  it('keeps a refusal when other watchers note successes at the same moment', async () => {
    const cli = `${folder}/racing`
    const refusal = answer('403 Forbidden', 'Retry-After: 120')
    const success = answer('200 OK', ...budgetHeaders(4000, NOW_SECONDS + 300))
    await Promise.all([noteLimits(cli, success, false), noteLimits(cli, refusal, true), noteLimits(cli, success, false), noteLimits(cli, success, false)])
    await noteLimits(cli, success, false)
    expect(await blockedUntil(cli, 'core')).not.toBeNull()
  })

  it('names the budget each kind of call spends', () => {
    expect(['api graphql -f x', 'api -i repos/o/n/pulls', 'run list', 'pr list', 'issue view 1'].map(call => resourceOf(call.split(' ')))).toEqual(['graphql', 'core', 'core', 'graphql', 'graphql'])
  })

  it('stops only the calls on the resource that ran out', async () => {
    const calls = `${folder}/core-calls`
    const reset = (Temporal.Now.instant().epochMilliseconds / 1000) + 600
    const headers = budgetHeaders(0, Math.floor(reset), 'core').map(header => `echo '< ${header}' >&2`).join('\n')
    const gh = await fakeGh('core-out', `echo "$1" >> ${calls}\necho '< HTTP/2.0 403 Forbidden' >&2\n${headers}\nif [ "$1" = api ]; then exit 1; fi`)
    await expect(ghText(['api', 'repos/o/n/pulls'], gh, true)).rejects.toThrow('exit 1')
    await expect(ghText(['run', 'list'], gh, true)).rejects.toThrow('rate limit')
    await ghText(['pr', 'list'], gh, true)
    expect(await linesOf(calls)).toEqual(['api', 'pr'])
  })

  it('runs two calls at once by default', async () => {
    const log = `${folder}/parallel-log`
    const gh = await fakeGh('parallel', `echo start >> ${log}\nsleep 0.2\necho end >> ${log}`)
    await Promise.all(['a', 'b', 'c', 'd'].map(async id => ghText([id], gh, true)))
    const running = (await linesOf(log)).reduce((seen, line) => {
      const now = seen.now + (line === 'start' ? 1 : -1)
      return { most: Math.max(seen.most, now), now }
    }, { most: 0, now: 0 })
    expect(running.most).toBe(2)
  })
})
