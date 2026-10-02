import { Temporal } from 'temporal-polyfill'
import { describe, expect, it } from 'vitest'
import { dueStatus } from './due'

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
