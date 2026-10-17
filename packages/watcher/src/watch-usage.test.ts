import { describe, expect, it } from 'bun:test'
import { usageFrom } from './watch-usage'

describe('usageFrom (#233)', () => {
  it('reads the five-hour and seven-day windows as whole percentages, with when each resets', () => {
    const answer = {
      five_hour: { resets_at: '2026-10-17T12:10:00.122917+00:00', utilization: 12.4 },
      seven_day: { resets_at: '2026-10-19T19:00:00.122936+00:00', utilization: 66 },
    }
    expect(usageFrom(answer, 'Europe/Berlin')).toBe('Usage: session 12% (resets 2026-10-17 14:10), week 66% (resets 2026-10-19 21:00)')
    expect(usageFrom({ five_hour: { resets_at: 'soon', utilization: 3 } }, 'UTC')).toBe('Usage: session 3%, week ?')
  })

  it('says unknown for anything else', () => {
    expect(usageFrom(null)).toBe('Usage: unknown')
    expect(usageFrom({ error: 'unauthorized' })).toBe('Usage: unknown')
  })
})
