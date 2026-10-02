import { describe, expect, it } from 'vitest'
import { datesOf, extraDatesOf, nextDate, sameDates } from './dates'

const membership = {
  dueDate: '2026-12-14',
  extraDates: [{ date: '2026-11-30', id: 'a', label: 'Cancel by' }, { date: 'soon', id: 'b', label: 'Broken' }],
}

describe('entry dates', () => {
  it('lists the due date and the usable extra dates in date order', () => {
    expect(datesOf(membership).map(entry => entry.label)).toEqual(['Cancel by', 'Due'])
    expect(extraDatesOf({})).toEqual([])
  })

  it('picks the next date from today on, or the last one once all have passed', () => {
    expect(nextDate(membership, '2026-10-02').label).toBe('Cancel by')
    expect(nextDate(membership, '2026-12-01').label).toBe('Due')
    expect(nextDate(membership, '2027-01-01').label).toBe('Due')
    // An overdue due date wins over a later extra date.
    expect(nextDate({ dueDate: '2026-10-01', extraDates: [{ date: '2026-12-01', id: 'x', label: 'Renews' }] }, '2026-10-02').label).toBe('Due')
    expect(nextDate({ dueDate: '2026-12-14' }, '2026-10-02').label).toBe('Due')
  })

  it('compares lists of dates by value', () => {
    expect(sameDates([{ date: '2026-11-30', id: 'a', label: 'Cancel by' }], [{ date: '2026-11-30', id: 'a', label: 'Cancel by' }])).toBe(true)
    expect(sameDates([], [{ date: '2026-11-30', id: 'a', label: 'Cancel by' }])).toBe(false)
    expect(sameDates([], [])).toBe(true)
  })
})
