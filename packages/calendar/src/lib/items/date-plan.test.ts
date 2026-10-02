import { describe, expect, it } from 'vitest'
import { DEFAULT_CATEGORIES } from '../categories'
import { dateEventFor, dateEventIdsOf, dateEventsAllowed, planDates, shapeOf } from './date-events'
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
