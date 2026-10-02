import { describe, expect, it } from 'vitest'
import { DEFAULT_CATEGORIES } from '../categories'
import { dateEventFor, dateEventIdsOf, dateEventsAllowed, isOrphanDate, planDates, shapeOf } from './date-events'
import type { Item } from './model'

const context = { categories: DEFAULT_CATEGORIES, timeZone: 'Europe/Berlin' }
const entryId = 'abcdefghijklmnopqrstuv0123'
const cancelBy = { date: '2099-11-30', id: '01234567', label: 'Cancel by' }

const base: Item = {
  amount: '', category: 'membership', code: '', dirty: [], dueDate: '2099-12-14', etags: {}, extraDates: [cancelBy], id: entryId, notes: 'Shared',
  pendingOp: null, rev: 'r1', startDate: '', status: 'open', sync: 'synced', syncError: null, title: 'Streaming', url: '',
}
const written = (item: Item) => ({ [cancelBy.id]: { shape: shapeOf(dateEventFor(item, cancelBy, context)) } })

describe('date events', () => {
  it('look like the entry, with the label, at 17:00 on their date, linked back to it', () => {
    expect(dateEventFor(base, cancelBy, context)).toMatchObject({
      description: 'Shared',
      end: { dateTime: '2099-11-30T17:15:00' },
      extendedProperties: { private: { 'hb.category': 'membership', 'hb.date': cancelBy.id, 'hb.entry': entryId, 'hb.label': 'Cancel by' } },
      id: `${entryId}d${cancelBy.id}`,
      reminders: { useDefault: true },
      start: { dateTime: '2099-11-30T17:00:00', timeZone: 'Europe/Berlin' },
      summary: '[Membership] Streaming · Cancel by',
    })
  })

  it('are planned when new, and not again once written in that shape', () => {
    expect(planDates(base, context)).toMatchObject([{ dateId: cancelBy.id, kind: 'upsert' }])
    expect(planDates({ ...base, dateEvents: written(base) }, context)).toEqual([])
  })

  it('are rewritten when their date or a shared field changes', () => {
    const synced = { ...base, dateEvents: written(base) }
    expect(planDates({ ...synced, extraDates: [{ ...cancelBy, date: '2099-11-29' }] }, context)).toMatchObject([{ kind: 'upsert' }])
    expect(planDates({ ...synced, title: 'Streaming plus' }, context)).toMatchObject([{ kind: 'upsert' }])
    // The due date is the entry's own event, not a date event.
    expect(planDates({ ...synced, dueDate: '2099-12-15' }, context)).toEqual([])
  })

  it('are deleted when their date is removed, and all of them go with the entry', () => {
    const synced = { ...base, dateEvents: written(base) }
    expect(planDates({ ...synced, extraDates: [] }, context)).toEqual([{ dateId: cancelBy.id, kind: 'delete' }])
    expect(dateEventIdsOf({ ...synced, extraDates: [{ ...cancelBy, id: '76543210' }] })).toEqual([`${entryId}d${cancelBy.id}`, `${entryId}d76543210`])
  })

  it('may only be written once every app that ever synced recognises them', () => {
    expect(dateEventsAllowed([{ schema: 2 }, { schema: 2 }])).toBe(true)
    expect(dateEventsAllowed([{ schema: 2 }, {}])).toBe(false)
    expect(dateEventsAllowed([])).toBe(false)
  })
})

describe('date events of an entry that came from Google with a longer id', () => {
  it('are never planned, since no app would recognise them', () => {
    const imported = { ...base, id: 'longgoogleeventid0123456789abcdef' }
    expect(planDates(imported, context)).toEqual([])
    expect(dateEventIdsOf(imported)).toEqual([])
  })
})

describe('a date event left in Google', () => {
  it('is an orphan once its entry is gone, or the entry neither has the date nor knows the event', () => {
    expect(isOrphanDate(null, cancelBy.id)).toBe(true)
    expect(isOrphanDate({ ...base, extraDates: [] }, cancelBy.id)).toBe(true)
  })

  it('is kept while the entry has the date, knows the event, or is about to be deleted with it', () => {
    expect(isOrphanDate(base, cancelBy.id)).toBe(false)
    expect(isOrphanDate({ ...base, dateEvents: { [cancelBy.id]: { shape: 'x' } }, extraDates: [] }, cancelBy.id)).toBe(false)
    expect(isOrphanDate({ ...base, extraDates: [], pendingOp: 'delete' }, cancelBy.id)).toBe(false)
  })
})

describe('date events of a done entry', () => {
  it('say done instead of the category and have no reminders', () => {
    expect(dateEventFor({ ...base, status: 'done' }, cancelBy, context)).toMatchObject({
      reminders: { overrides: [], useDefault: false },
      summary: '[Done] Streaming · Cancel by',
    })
  })
})
