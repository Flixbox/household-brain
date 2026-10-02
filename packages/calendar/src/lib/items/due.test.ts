import { Temporal } from 'temporal-polyfill'
import { describe, expect, it } from 'vitest'
import { dueStatus, rowDue, startLabel } from './due'

const at = (dateTime: string) => Temporal.PlainDateTime.from(dateTime).toZonedDateTime('Europe/Berlin')

describe('dueStatus', () => {
  it.each([
    ['2026-11-03', '2026-11-03T09:00', 'today, 17:00', 'soon'],
    ['2026-11-03', '2026-11-03T16:59', 'today, 17:00', 'soon'],
    ['2026-11-03', '2026-11-03T17:00', 'overdue since 17:00 today', 'overdue'],
    ['2026-11-03', '2026-11-04T08:00', 'overdue by 1 day', 'overdue'],
    ['2026-11-03', '2026-11-06T20:00', 'overdue by 3 days', 'overdue'],
    ['2026-11-03', '2026-11-02T23:30', 'tomorrow, 17:00', 'soon'],
    ['2026-11-09', '2026-11-02T12:00', 'in 7 days', 'soon'],
    ['2026-11-10', '2026-11-02T12:00', 'in 8 days', 'later'],
  ])('due %s, at %s: %s (%s)', (...[dueDate, now, label, urgency]) => {
    expect(dueStatus(dueDate, at(now))).toEqual({ label, urgency })
  })

  it('counts calendar days across the switch to winter time', () => {
    expect(dueStatus('2026-10-26', at('2026-10-24T18:00'))).toEqual({ label: 'in 2 days', urgency: 'soon' })
  })
})

describe('rowDue', () => {
  it('describes an open entry by when it is due', () => {
    expect(rowDue({ dueDate: '2026-10-01', status: 'open' }, at('2026-10-31T12:00'))).toEqual({ label: 'overdue by 30 days', urgency: 'overdue' })
  })

  it('describes a done or cancelled entry by its status, never as overdue', () => {
    expect(rowDue({ dueDate: '2026-10-01', status: 'done' }, at('2026-10-31T12:00'))).toEqual({ label: 'done', urgency: 'later' })
    expect(rowDue({ dueDate: '2026-11-01', status: 'cancelled' }, at('2026-10-31T12:00'))).toEqual({ label: 'cancelled', urgency: 'later' })
  })
})

describe('startLabel', () => {
  it('says since a start date that has come, from one still ahead, nothing without one', () => {
    expect(startLabel('2026-08-15', at('2026-10-02T12:00'))).toBe('since 2026-08-15')
    expect(startLabel('2026-10-02', at('2026-10-02T12:00'))).toBe('since 2026-10-02')
    expect(startLabel('2026-11-01', at('2026-10-02T12:00'))).toBe('from 2026-11-01')
    expect(startLabel('', at('2026-10-02T12:00'))).toBeNull()
    expect(startLabel(null, at('2026-10-02T12:00'))).toBeNull()
    expect(startLabel('next spring', at('2026-10-02T12:00'))).toBeNull()
  })
})
