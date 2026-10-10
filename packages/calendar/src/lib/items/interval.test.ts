import { describe, expect, it } from 'vitest'
import { INTERVALS, intervalFrom, withInterval } from './interval'

describe('intervals (#86)', () => {
  it('offers the seven intervals the owner asked for, from daily to yearly', () => {
    expect(INTERVALS.map(interval => interval.value)).toEqual(['daily', 'weekly', 'biweekly', 'monthly', 'quarterly', 'half-yearly', 'yearly'])
  })

  it('reads only known values; anything else is a one-off price', () => {
    expect(intervalFrom('yearly')).toBe('yearly')
    expect(intervalFrom('Yearly')).toBe('')
    expect(intervalFrom(null)).toBe('')
    expect(intervalFrom(12)).toBe('')
  })

  it('shows the interval after the price', () => {
    expect(withInterval('15,00 €', 'monthly')).toBe('15,00 € / month')
    expect(withInterval('15,00 €', 'biweekly')).toBe('15,00 € / 2 weeks')
    expect(withInterval('15,00 €', '')).toBe('15,00 €')
  })
})
