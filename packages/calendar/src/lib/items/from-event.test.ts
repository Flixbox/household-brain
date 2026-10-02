import { describe, expect, it } from 'vitest'
import { DEFAULT_CATEGORIES } from '../categories'
import type { CalendarEvent } from './event'
import { draftFrom, normalisationFor } from './from-event'

const context = { categories: DEFAULT_CATEGORIES, timeZone: 'Europe/Berlin' }
const appEvent: CalendarEvent = {
  description: 'Only online',
  end: { dateTime: '2026-11-03T17:15:00+01:00', timeZone: 'Europe/Berlin' },
  extendedProperties: { private: { 'hb.amount': '10', 'hb.category': 'coupon', 'hb.code': 'X1', 'hb.start': '2026-10-01', 'hb.status': 'done', 'hb.url': '' } },
  reminders: { useDefault: true },
  start: { dateTime: '2026-11-03T17:00:00+01:00', timeZone: 'Europe/Berlin' },
  summary: '[Coupon] Amazon',
}

describe('draftFrom', () => {
  it('reads an event the app wrote', () => {
    expect(draftFrom(appEvent, DEFAULT_CATEGORIES)).toEqual({
      amount: '10', category: 'coupon', code: 'X1', dueDate: '2026-11-03', notes: 'Only online', startDate: '2026-10-01', status: 'done', title: 'Amazon', url: '',
    })
  })

  it('takes the category from a title prefix of an event made in Google Calendar', () => {
    const draft = draftFrom({ start: { date: '2026-12-01' }, summary: '[membership] Gym' }, DEFAULT_CATEGORIES)
    expect(draft).toMatchObject({ category: 'membership', dueDate: '2026-12-01', status: 'open', title: 'Gym' })
  })

  it('keeps a bracketed title that is not a category, even on an app entry', () => {
    expect(draftFrom({ ...appEvent, summary: '[Draft] Foo' }, DEFAULT_CATEGORIES).title).toBe('[Draft] Foo')
  })

  it('files an event without a known prefix as uncategorised, keeping its whole title', () => {
    expect(draftFrom({ start: { date: '2026-12-01' }, summary: '[Party] Bring cake' }, DEFAULT_CATEGORIES))
      .toMatchObject({ category: 'uncategorised', title: '[Party] Bring cake' })
  })
})

describe('normalisationFor', () => {
  it('leaves an event that already fits alone', () => {
    expect(normalisationFor(appEvent, draftFrom(appEvent, DEFAULT_CATEGORIES), context)).toBeNull()
  })

  it('moves a 09:00 or all-day event to 17:00–17:15 on the same date and restores default reminders', () => {
    const moved: CalendarEvent = { ...appEvent, reminders: { overrides: [{ method: 'popup', minutes: 10 }], useDefault: false }, start: { date: '2026-11-04' } }
    expect(normalisationFor(moved, draftFrom(moved, DEFAULT_CATEGORIES), context)).toEqual({
      end: { date: null, dateTime: '2026-11-04T17:15:00', timeZone: 'Europe/Berlin' },
      reminders: { overrides: [], useDefault: true },
      start: { date: null, dateTime: '2026-11-04T17:00:00', timeZone: 'Europe/Berlin' },
    })
  })

  it('never rewrites events put in by hand, or repeating events', () => {
    const birthday: CalendarEvent = { reminders: { useDefault: false }, start: { date: '2026-12-01' }, summary: 'Grandma' }
    expect(normalisationFor(birthday, draftFrom(birthday, DEFAULT_CATEGORIES), context)).toBeNull()
    const yearly: CalendarEvent = { ...appEvent, recurrence: ['RRULE:FREQ=YEARLY'], start: { date: '2020-01-01' } }
    expect(normalisationFor(yearly, draftFrom(yearly, DEFAULT_CATEGORIES), context)).toBeNull()
  })

  it('gives an event made in Google Calendar its category, prefix and colour', () => {
    const made: CalendarEvent = { ...appEvent, extendedProperties: {}, summary: '[Membership] Gym' }
    expect(normalisationFor(made, draftFrom(made, DEFAULT_CATEGORIES), context)).toEqual({
      colorId: '3',
      extendedProperties: { private: { 'hb.category': 'membership', 'hb.v': '1' } },
      summary: '[Membership] Gym',
    })
  })
})
