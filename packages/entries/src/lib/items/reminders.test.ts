import { describe, expect, it } from 'vitest'
import { reminderMinutes, remindersFromText, remindersValue } from './reminders'

describe('reminders', () => {
  it('reads the household default as its two reminders, and none as none', () => {
    expect(reminderMinutes('')).toEqual([2880, 1440])
    expect(reminderMinutes('none')).toEqual([])
    expect(reminderMinutes('10080,0')).toEqual([10080, 0])
  })

  it('stores the default as empty, none as "none", and anything else largest first', () => {
    expect(remindersValue([1440, 2880])).toBe('')
    expect(remindersValue([])).toBe('none')
    expect(remindersValue([0, 10080, 0])).toBe('10080,0')
  })

  it("keeps within Google's limits: five at most, none beyond four weeks", () => {
    expect(remindersValue([0, 1440, 2880, 10080, 20160, 40320])).toBe('40320,20160,10080,2880,1440')
    expect(remindersValue([50_000, -5, 1.5, 60])).toBe('60')
  })

  it('reads what another client stored, and anything malformed as the default', () => {
    expect(remindersFromText('none')).toBe('none')
    expect(remindersFromText('1440,2880')).toBe('')
    expect(remindersFromText('60,10080')).toBe('10080,60')
    expect(remindersFromText('soon')).toBe('')
    // Every time out of Google's limits: still the default, never "no reminders".
    expect(remindersFromText('50000')).toBe('')
  })
})
