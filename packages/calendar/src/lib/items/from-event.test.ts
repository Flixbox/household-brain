import { describe, expect, it } from 'vitest'
import { DEFAULT_CATEGORIES } from '@household-brain/calendar/lib/categories'
import type { CalendarEvent } from './event'
import { draftFrom, normalisationFor, ownRemindersFix } from './from-event'

const context = { categories: DEFAULT_CATEGORIES, timeZone: 'Europe/Berlin' }
const appEvent: CalendarEvent = {
  description: 'Only online',
  end: { dateTime: '2026-11-03T17:15:00+01:00', timeZone: 'Europe/Berlin' },
  extendedProperties: { private: { 'hb.amount': '10', 'hb.category': 'coupon', 'hb.code': 'X1', 'hb.start': '2026-10-01', 'hb.status': 'open', 'hb.url': '' } },
  reminders: { useDefault: true },
  start: { dateTime: '2026-11-03T17:00:00+01:00', timeZone: 'Europe/Berlin' },
  summary: '[Coupon] Amazon',
}

describe('draftFrom', () => {
  it('reads an event the app wrote', () => {
    expect(draftFrom(appEvent, DEFAULT_CATEGORIES)).toEqual({
      amount: '10', category: 'coupon', code: 'X1', currency: '', dueDate: '2026-11-03', interval: '', notes: 'Only online', reminders: '', startDate: '2026-10-01', status: 'open', title: 'Amazon', url: '',
    })
  })

  it('reads how often the price is due, and nothing it doesn\'t know (#86)', () => {
    const every = (value: string) => draftFrom({ ...appEvent, extendedProperties: { private: { ...appEvent.extendedProperties?.private, 'hb.interval': value } } }, DEFAULT_CATEGORIES).interval
    expect(every('monthly')).toBe('monthly')
    expect(every('fortnightly')).toBe('')
  })

  it('reads another currency, and euros or anything malformed as none', () => {
    const inCurrency = (code: string) => draftFrom({ ...appEvent, extendedProperties: { private: { ...appEvent.extendedProperties?.private, 'hb.currency': code } } }, DEFAULT_CATEGORIES).currency
    expect(inCurrency('BRL')).toBe('BRL')
    expect(inCurrency('EUR')).toBe('')
    expect(inCurrency('real')).toBe('')
  })

  it('takes the details of an event made outside the app from its description, once (#83)', () => {
    const made = { description: 'Code: SUMMER25\nAmount: 10 €\nOnly online', start: { date: '2026-12-01' }, summary: '[Coupon] Cinema' }
    expect(draftFrom(made, DEFAULT_CATEGORIES)).toMatchObject({ amount: '10', category: 'coupon', code: 'SUMMER25', notes: 'Only online', title: 'Cinema' })
    // Written to the event when it is taken in, so the next pull reads the same fields back.
    expect(normalisationFor(made, draftFrom(made, DEFAULT_CATEGORIES), context)).toMatchObject({
      description: 'Only online',
      extendedProperties: { private: { 'hb.amount': '10', 'hb.category': 'coupon', 'hb.code': 'SUMMER25', 'hb.v': '1' } },
    })
    // An event put in by hand without a category keeps its description as it is.
    expect(draftFrom({ ...made, summary: 'Cinema' }, DEFAULT_CATEGORIES).notes).toBe(made.description)
    // The app's own events read their fields from their properties, never from the description.
    expect(draftFrom(appEvent, DEFAULT_CATEGORIES).notes).toBe(appEvent.description)
  })

  it("reads a done or cancelled entry's title without its status tag", () => {
    const done = { ...appEvent, extendedProperties: { private: { ...appEvent.extendedProperties?.private, 'hb.status': 'done' } }, summary: '[Done] Amazon' }
    expect(draftFrom(done, DEFAULT_CATEGORIES)).toMatchObject({ category: 'coupon', status: 'done', title: 'Amazon' })
    expect(draftFrom({ ...done, summary: '[Cancelled] Amazon' }, DEFAULT_CATEGORIES).title).toBe('Amazon')
    // On an open entry, or without the app's category, "[Done]" is just part of the title.
    expect(draftFrom({ ...appEvent, summary: '[Done] Amazon' }, DEFAULT_CATEGORIES).title).toBe('[Done] Amazon')
    expect(draftFrom({ start: { date: '2026-12-01' }, summary: '[Done] Bake' }, DEFAULT_CATEGORIES).title).toBe('[Done] Bake')
  })

  it('takes the category from a title prefix of an event made in Google Calendar', () => {
    const draft = draftFrom({ start: { date: '2026-12-01' }, summary: '[membership] Gym' }, DEFAULT_CATEGORIES)
    expect(draft).toMatchObject({ category: 'membership', dueDate: '2026-12-01', status: 'open', title: 'Gym' })
  })

  it('takes the category from a word the Gemini app tags with, and drops further tags that name one (#92)', () => {
    expect(draftFrom({ start: { date: '2026-12-01' }, summary: '[Deal] Shop 10 €' }, DEFAULT_CATEGORIES)).toMatchObject({ category: 'coupon', title: 'Shop 10 €' })
    expect(draftFrom({ start: { date: '2026-12-01' }, summary: '[Paperwork] [Deadline] Return shoes' }, DEFAULT_CATEGORIES)).toMatchObject({ category: 'paperwork', title: 'Return shoes' })
    // An unknown tag stays part of the title.
    expect(draftFrom({ start: { date: '2026-12-01' }, summary: '[Coupon] [Party] Cake' }, DEFAULT_CATEGORIES).title).toBe('[Party] Cake')
    expect(draftFrom({ start: { date: '2026-12-01' }, summary: '[Coupon] [Party]  [Deal] Cake' }, DEFAULT_CATEGORIES).title).toBe('[Party]  Cake')
    expect(draftFrom({ start: { date: '2026-12-01' }, summary: '[Coupon] [Deal]' }, DEFAULT_CATEGORIES).title).toBe('[Deal]')
    // An app entry with only an unknown tag keeps its title exactly, so its event isn't renamed.
    const unknown = { ...appEvent, summary: '[Coupon] [Draft]Foo' }
    expect(draftFrom(unknown, DEFAULT_CATEGORIES).title).toBe('[Draft]Foo')
    expect(normalisationFor(unknown, draftFrom(unknown, DEFAULT_CATEGORIES), context)).toBeNull()
    // The event is renamed when taken in, and so is one the app already has that still carries a tag.
    const tagged = { ...appEvent, summary: '[Coupon] [Deal] Amazon' }
    expect(normalisationFor(tagged, draftFrom(tagged, DEFAULT_CATEGORIES), context)).toEqual({ summary: '[Coupon] Amazon' })
    const done = { ...tagged, extendedProperties: { private: { ...appEvent.extendedProperties?.private, 'hb.status': 'done' } }, reminders: { overrides: [], useDefault: false }, summary: '[Done] [Deal] Amazon' }
    expect(draftFrom(done, DEFAULT_CATEGORIES).title).toBe('Amazon')
    expect(normalisationFor(done, draftFrom(done, DEFAULT_CATEGORIES), context)).toEqual({ summary: '[Done] Amazon' })
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

  it('expects no reminders on a done or cancelled entry, and removes default ones', () => {
    const done: CalendarEvent = { ...appEvent, extendedProperties: { private: { ...appEvent.extendedProperties?.private, 'hb.status': 'done' } }, summary: '[Done] Amazon' }
    expect(normalisationFor({ ...done, reminders: { overrides: [], useDefault: false } }, draftFrom(done, DEFAULT_CATEGORIES), context)).toBeNull()
    expect(normalisationFor(done, draftFrom(done, DEFAULT_CATEGORIES), context)).toEqual({ reminders: { overrides: [], useDefault: false } })
  })

  it("fixes this person's own reminders after the other person's push of new reminders", () => {
    const withOwn = { ...appEvent, extendedProperties: { private: { ...appEvent.extendedProperties?.private, 'hb.reminders': '10080' } } }
    const draft = draftFrom(withOwn, DEFAULT_CATEGORIES)
    expect(draft.reminders).toBe('10080')
    expect(ownRemindersFix(withOwn, draft, DEFAULT_CATEGORIES)).toEqual({ reminders: { overrides: [{ method: 'popup', minutes: 10080 }], useDefault: false } })
    const applied = { ...withOwn, reminders: { overrides: [{ method: 'popup', minutes: 10080 }], useDefault: false } }
    expect(ownRemindersFix(applied, draft, DEFAULT_CATEGORIES)).toBeNull()
  })

  it("fixes this person's own reminders after the other person's push, by status", () => {
    const done: CalendarEvent = { ...appEvent, extendedProperties: { private: { ...appEvent.extendedProperties?.private, 'hb.status': 'done' } }, summary: '[Done] Amazon' }
    expect(ownRemindersFix(done, draftFrom(done, DEFAULT_CATEGORIES), DEFAULT_CATEGORIES)).toEqual({ reminders: { overrides: [], useDefault: false } })
    const reopened = { ...appEvent, reminders: { useDefault: false } }
    expect(ownRemindersFix(reopened, draftFrom(reopened, DEFAULT_CATEGORIES), DEFAULT_CATEGORIES)).toEqual({ reminders: { overrides: [], useDefault: true } })
    expect(ownRemindersFix(appEvent, draftFrom(appEvent, DEFAULT_CATEGORIES), DEFAULT_CATEGORIES)).toBeNull()
    const birthday: CalendarEvent = { reminders: { useDefault: false }, start: { date: '2026-12-01' }, summary: 'Grandma' }
    expect(ownRemindersFix(birthday, draftFrom(birthday, DEFAULT_CATEGORIES), DEFAULT_CATEGORIES)).toBeNull()
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

  it('ignores a start date that is not a date', () => {
    const odd = { ...appEvent, extendedProperties: { private: { ...appEvent.extendedProperties?.private, 'hb.start': 'next spring' } } }
    expect(draftFrom(odd, DEFAULT_CATEGORIES).startDate).toBe('')
  })
})
