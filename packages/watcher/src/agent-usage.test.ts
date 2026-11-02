import { describe, expect, it } from 'bun:test'
import { codexCache, usageProvider } from './agent-usage'
import { codexAnswer } from './codex-usage'

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
