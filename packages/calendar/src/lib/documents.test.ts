import { describe, expect, it } from 'vitest'
import { categoryFrom, householdFrom, itemFrom } from './documents'

describe('itemFrom', () => {
  it('reads a complete entry as it is', () => {
    const data = {
      amount: '10', category: 'coupon', code: 'SUMMER25', currency: '', dirty: ['code'], dueDate: '2026-11-03', etags: { owner: '"1"' }, id: 'evt1', interval: 'monthly',
      notes: '', pendingOp: 'upsert', reminders: '', rev: 'r1', startDate: '', status: 'open', sync: 'pending', syncError: null, title: 'Amazon', url: '',
    }
    expect(itemFrom('evt1', data)).toEqual(data)
  })

  it("takes the document's own id, whatever the data says", () => {
    expect(itemFrom('doc-id', { id: 'other' }).id).toBe('doc-id')
    expect(itemFrom('doc-id', { id: '' }).id).toBe('doc-id')
  })

  it('passes the optional fields through, and reads the less common states', () => {
    const updatedAt = { nanoseconds: 0, seconds: 1 }
    const item = itemFrom('e', { googleUpdated: '2026-10-01T10:00:05.000Z', pendingOp: 'delete', syncError: 'refused', updatedAt, updatedBy: 'u1' })
    expect(item).toMatchObject({ googleUpdated: '2026-10-01T10:00:05.000Z', pendingOp: 'delete', syncError: 'refused', updatedAt, updatedBy: 'u1' })
    // A server timestamp not yet written reads as null, and stays so.
    expect(itemFrom('e', { updatedAt: null }).updatedAt).toBeNull()
    expect(itemFrom('e', { dateEvents: { abc: { error: 7, shape: 's' } } }).dateEvents).toEqual({ abc: { shape: 's' } })
  })

  it('fills in what an older or stray document lacks, and leaves optional fields out', () => {
    const item = itemFrom('doc-id', { dirty: ['code', 'nonsense'], etags: { owner: 1 }, status: 'archived', sync: 'unknown', title: 'Gym' })
    expect(item).toEqual({
      amount: '', category: '', code: '', currency: '', dirty: ['code'], dueDate: '', etags: {}, id: 'doc-id', interval: '', notes: '', pendingOp: null,
      reminders: '', rev: '', startDate: '', status: 'open', sync: 'pending', syncError: null, title: 'Gym', url: '',
    })
    expect(item).not.toHaveProperty('extraDates')
  })

  it('reads the extra dates and their ledger', () => {
    const item = itemFrom('e', {
      dateEvents: { abc: { error: 'refused', shape: 's1' }, bad: 'x' },
      extraDates: [{ date: '2099-11-30', id: 'abc', label: 'Cancel by' }, 'junk'],
    })
    expect(item.extraDates).toEqual([{ date: '2099-11-30', id: 'abc', label: 'Cancel by' }])
    expect(item.dateEvents).toEqual({ abc: { error: 'refused', shape: 's1' } })
  })
})

describe('categoryFrom and householdFrom', () => {
  it('read their documents, with fallbacks', () => {
    expect(categoryFrom('coupon', { colorId: '6', label: 'Coupon', slug: 'coupon', sortOrder: 1 })).toEqual({ colorId: '6', label: 'Coupon', slug: 'coupon', sortOrder: 1 })
    expect(categoryFrom('misc', {})).toEqual({ colorId: '8', label: 'misc', slug: 'misc', sortOrder: Number.MAX_SAFE_INTEGER })
    expect(householdFrom({ calendarId: 'cal-1', ownerUid: 'u1', timeZone: 'Europe/Berlin' })).toEqual({ calendarId: 'cal-1', ownerUid: 'u1', timeZone: 'Europe/Berlin' })
    expect(householdFrom({ ownerUid: 'u1' })).toBeNull()
    expect(householdFrom({ calendarId: 'cal-1' })).toEqual({ calendarId: 'cal-1', ownerUid: '', timeZone: 'Europe/Berlin' })
  })
})
