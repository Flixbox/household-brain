/* oxlint-disable import/no-nodejs-modules -- a temporary folder for each run; node:fs/promises and node:os are built into Bun */
import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { codexCache, usageProvider } from './agent-usage'
import { usageLockPort } from './claude-usage'
import { codexAnswer } from './codex-usage'

const dirs: string[] = []
afterEach(async () => {
  await Promise.all(dirs.splice(0).map(async dir => rm(dir, { force: true, recursive: true })))
})

/** `agent-usage` as its own process, with no login or Codex to reach; stopped well before the 20 s a held lock waits. */
const usageRun = async (provider: string, setting: string, port: string) => {
  const dir = await mkdtemp(`${tmpdir()}/agent-usage-`)
  dirs.push(dir)
  const cache = `${dir}/cache.json`
  const run = Bun.spawn([process.execPath, `${import.meta.dir}/agent-usage.ts`], {
    env: { AGENT_USAGE_PROVIDER: provider, CLAUDE_CONFIG_DIR: dir, CLAUDE_USAGE_CACHE: cache, CODEX_HOME: dir, CODEX_USAGE_CACHE: cache, HOME: dir, [setting]: port },
    stderr: 'pipe',
    stdout: 'ignore',
    timeout: 10_000,
  })
  const [stderr, exitCode] = await Promise.all([new Response(run.stderr).text(), run.exited])
  return { asked: await Bun.file(cache).exists(), exitCode, stderr }
}

describe('an invalid lock port (#521)', () => {
  it.each([
    ['claude', 'CLAUDE_USAGE_LOCK_PORT', 'abc'],
    ['codex', 'CODEX_USAGE_LOCK_PORT', '99999'],
    ['claude', 'CLAUDE_USAGE_LOCK_PORT', '0'],
    ['codex', 'CODEX_USAGE_LOCK_PORT', '1.5'],
  ])('%s: %s=%s is reported and still lets the read ask', async (provider, setting, port) => {
    const { asked, exitCode, stderr } = await usageRun(provider, setting, port)
    expect(stderr).toContain(setting)
    expect(exitCode).toBe(0)
    expect(asked).toBe(true)
  }, 15_000)

  it('uses a valid port as given and the picked one when none is set', () => {
    expect(usageLockPort('PORT_FOR_TEST', '/cache', { PORT_FOR_TEST: '1' })).toBe(1)
    expect(usageLockPort('PORT_FOR_TEST', '/cache', { PORT_FOR_TEST: '65535' })).toBe(65_535)
    expect(usageLockPort('PORT_FOR_TEST', '/cache', {})).toBeGreaterThanOrEqual(10_000)
  })
})

describe('the active agent usage provider (#338)', () => {
  it('selects Codex in Codex and keeps Claude as the default outside it', () => {
    expect(usageProvider({ CODEX_THREAD_ID: 'thread' })).toBe('codex')
    expect(usageProvider({ CLAUDECODE: '1', CODEX_THREAD_ID: 'thread' })).toBe('codex')
    expect(usageProvider({ CLAUDECODE: '1' })).toBe('claude')
    expect(usageProvider({})).toBe('claude')
  })

  it('isolates Codex homes and honours a Codex-only cache override', () => {
    const first = codexCache({ CODEX_HOME: '/one', HOME: '/user' })
    expect(codexCache({ CODEX_HOME: '/two', HOME: '/user' })).not.toBe(first)
    expect(codexCache({ CLAUDE_USAGE_CACHE: '/claude', CODEX_HOME: '/one', HOME: '/user' })).toBe(first)
    expect(codexCache({ CODEX_USAGE_CACHE: '/chosen' })).toBe('/chosen')
  })

  it('lets an explicit provider override the calling agent, rejecting typos', () => {
    expect(usageProvider({ AGENT_USAGE_PROVIDER: 'claude', CODEX_THREAD_ID: 'thread' })).toBe('claude')
    expect(usageProvider({ AGENT_USAGE_PROVIDER: 'codex', CLAUDECODE: '1' })).toBe('codex')
    expect(() => usageProvider({ AGENT_USAGE_PROVIDER: 'typo' })).toThrow('AGENT_USAGE_PROVIDER')
  })
})

describe('Codex rate limit windows (#338)', () => {
  it('maps actual window durations, not primary and secondary positions', () => {
    const limits = { rateLimits: {
      primary: { resetsAt: 1_793_000_000, usedPercent: 12, windowDurationMins: 10_080 },
      secondary: { resetsAt: 1_792_500_000, usedPercent: 34, windowDurationMins: 300 },
    } }
    expect(codexAnswer(limits)).toEqual({
      five_hour: { resets_at: Temporal.Instant.fromEpochMilliseconds(1_792_500_000_000).toString(), utilization: 34 },
      seven_day: { resets_at: Temporal.Instant.fromEpochMilliseconds(1_793_000_000_000).toString(), utilization: 12 },
    })
  })

  it('does not turn an absent or malformed allowance into zero usage', () => {
    expect(codexAnswer({})).toBeNull()
    expect(codexAnswer({ rateLimits: { primary: { usedPercent: 20, windowDurationMins: 300 } } })).toBeNull()
    expect(codexAnswer({ rateLimits: { primary: { usedPercent: 0, windowDurationMins: 60 } } })).toBeNull()
    expect(codexAnswer({ rateLimits: { secondary: { usedPercent: '0', windowDurationMins: 10_080 } } })).toBeNull()
  })
})
