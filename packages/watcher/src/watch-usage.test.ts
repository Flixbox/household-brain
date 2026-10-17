import { describe, expect, it } from 'bun:test'
import { usageFrom } from './watch-usage'

describe('usageFrom (#233)', () => {
  it('reads the five-hour and seven-day windows as whole percentages', () => {
    expect(usageFrom({ five_hour: { utilization: 12.4 }, seven_day: { utilization: 66 } })).toBe('Usage: session 12%, week 66%')
    expect(usageFrom({ five_hour: { utilization: 3 } })).toBe('Usage: session 3%, week ?')
  })

  it('says unknown for anything else', () => {
    expect(usageFrom(null)).toBe('Usage: unknown')
    expect(usageFrom({ error: 'unauthorized' })).toBe('Usage: unknown')
  })
})
