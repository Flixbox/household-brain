import { describe, expect, it } from 'vitest'
import { DEFAULT_CATEGORIES } from '@household-brain/calendar/lib/categories'
import { dateEventFor, shapeOf } from './date-events'
import { dateEventChange } from './date-pull'
import type { Item } from './model'

const context = { categories: DEFAULT_CATEGORIES, timeZone: 'Europe/Berlin' }
const cancelBy = { date: '2099-11-30', id: '01234567', label: 'Cancel by' }
const draft: Item = {
  amount: '', category: 'membership', code: '', currency: '', dirty: [], dueDate: '2099-12-14', etags: {}, extraDates: [cancelBy], id: 'abcdefghijklmnopqrstuv0123', notes: 'Shared',
  pendingOp: null, reminders: '', rev: 'r1', startDate: '', status: 'open', sync: 'synced', syncError: null, title: 'Streaming', url: '',
}
const written = dateEventFor(draft, cancelBy, context)
const item: Item = { ...draft, dateEvents: { [cancelBy.id]: { shape: shapeOf(written) } } }
// As Google hands it back: the time with an offset, the reminders, an etag.
const asGoogle = {
  ...written,
  end: { dateTime: '2099-11-30T17:15:00+01:00', timeZone: 'Europe/Berlin' },
  etag: '"1"',
  start: { dateTime: '2099-11-30T17:00:00+01:00', timeZone: 'Europe/Berlin' },
}
const change = (event: object, entry = item) => dateEventChange({ dateId: cancelBy.id, event, item: entry }, context)

describe('a date event changed in Google', () => {
  it('as the app wrote it: nothing to do', () => {
    expect(change(asGoogle)).toEqual({ kind: 'none' })
    // Google leaves out an empty description.
    const plain = { ...draft, notes: '' }
    const { description: _description, ...withoutNotes } = asGoogle
    expect(change(withoutNotes, { ...plain, dateEvents: { [cancelBy.id]: { shape: shapeOf(dateEventFor(plain, cancelBy, context)) } } })).toEqual({ kind: 'none' })
  })

  it('moved: the entry takes the new date', () => {
    const moved = { ...asGoogle, end: { ...asGoogle.end, dateTime: '2099-11-28T17:15:00+01:00' }, start: { ...asGoogle.start, dateTime: '2099-11-28T17:00:00+01:00' } }
    expect(change(moved)).toEqual({ date: '2099-11-28', kind: 'adopt' })
    expect(change({ ...asGoogle, end: { date: '2099-11-29' }, start: { date: '2099-11-28' } })).toEqual({ date: '2099-11-28', kind: 'adopt' })
  })

  it('deleted: the entry drops the date', () => {
    expect(change({ id: written.id, status: 'cancelled' })).toEqual({ kind: 'remove' })
  })

  it('edited otherwise: put back', () => {
    expect(change({ ...asGoogle, summary: 'Renamed' })).toEqual({ kind: 'rewrite' })
    expect(change({ ...asGoogle, start: { ...asGoogle.start, dateTime: '2099-11-30T09:00:00+01:00' } })).toEqual({ kind: 'rewrite' })
    expect(change({ ...asGoogle, reminders: { overrides: [{ method: 'popup', minutes: 10 }], useDefault: false } })).toEqual({ kind: 'rewrite' })
    expect(change({ ...asGoogle, extendedProperties: { private: { ...written.extendedProperties?.private, 'hb.code': 'X' } } })).toEqual({ kind: 'rewrite' })
  })

  it("with the entry's own reminders: fits only when this person's copy has them, in any order", () => {
    const own = { ...draft, reminders: '10080,1440' }
    const ownWritten = dateEventFor(own, cancelBy, context)
    const entry = { ...own, dateEvents: { [cancelBy.id]: { shape: shapeOf(ownWritten) } } }
    const asTheirs = { ...asGoogle, extendedProperties: ownWritten.extendedProperties }
    // The other person's write left this person's copy at the defaults: put back as this person.
    expect(change({ ...asTheirs, reminders: { useDefault: true } }, entry)).toEqual({ kind: 'rewrite' })
    const reversed = [{ method: 'popup', minutes: 1440 }, { method: 'popup', minutes: 10080 }]
    expect(change({ ...asTheirs, reminders: { overrides: reversed, useDefault: false } }, entry)).toEqual({ kind: 'none' })
  })

  it('while the app has its own change for that event, or the entry is being deleted: the app wins', () => {
    expect(change({ id: written.id, status: 'cancelled' }, { ...item, title: 'Streaming plus' })).toEqual({ kind: 'none' })
    expect(change({ id: written.id, status: 'cancelled' }, { ...item, pendingOp: 'delete' })).toEqual({ kind: 'none' })
    expect(change({ ...asGoogle, summary: 'Renamed' }, { ...item, extraDates: [] })).toEqual({ kind: 'none' })
  })
})
