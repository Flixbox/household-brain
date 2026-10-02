import { describe, expect, it } from 'vitest'
import { DEFAULT_CATEGORIES } from '../categories'
import { isEventId, newEventId } from './ids'
import { eventFor, patchFor, summaryOf } from './event'
import type { Item } from './model'

const context = { categories: DEFAULT_CATEGORIES, timeZone: 'Europe/Berlin' }

const item: Item = {
  amount: '10',
  category: 'coupon',
  code: 'SUMMER25',
  dirty: [],
  dueDate: '2026-11-03',
  etags: {},
  id: 'abc123def456',
  notes: 'Only online',
  pendingOp: null,
  rev: 'r1',
  startDate: '2026-10-01',
  status: 'open',
  sync: 'pending',
  syncError: null,
  title: 'Amazon',
  url: 'https://shop.household-brain.test',
}

describe('eventFor', () => {
  it('is due 17:00–17:15 in the calendar time zone, prefixed and coloured by category', () => {
    expect(eventFor(item, context)).toEqual({
      colorId: '6',
      description: 'Only online',
      end: { dateTime: '2026-11-03T17:15:00', timeZone: 'Europe/Berlin' },
      extendedProperties: {
        private: { 'hb.amount': '10', 'hb.category': 'coupon', 'hb.code': 'SUMMER25', 'hb.start': '2026-10-01', 'hb.status': 'open', 'hb.url': 'https://shop.household-brain.test', 'hb.v': '1' },
      },
      id: 'abc123def456',
      reminders: { useDefault: true },
      start: { dateTime: '2026-11-03T17:00:00', timeZone: 'Europe/Berlin' },
      summary: '[Coupon] Amazon',
    })
  })

  it('leaves the title unprefixed for an unknown category', () => {
    expect(summaryOf({ category: 'gone', title: 'Thing' }, DEFAULT_CATEGORIES)).toBe('Thing')
  })
})

describe('patchFor', () => {
  it('sends only what the changed fields affect', () => {
    expect(patchFor(item, ['dueDate'], context)).toEqual({
      end: { date: null, dateTime: '2026-11-03T17:15:00', timeZone: 'Europe/Berlin' },
      start: { date: null, dateTime: '2026-11-03T17:00:00', timeZone: 'Europe/Berlin' },
    })
    expect(Object.keys(patchFor(item, ['category'], context)).toSorted()).toEqual(['colorId', 'extendedProperties', 'summary'])
    expect(patchFor(item, [], context)).toEqual({})
  })

  it('sends only the changed fields\' private properties, so others\' concurrent ones survive', () => {
    expect(patchFor(item, ['status'], context)).toEqual({ extendedProperties: { private: { 'hb.status': item.status, 'hb.v': '1' } } })
    expect(patchFor(item, ['code', 'url'], context)).toEqual({ extendedProperties: { private: { 'hb.code': 'SUMMER25', 'hb.url': item.url, 'hb.v': '1' } } })
    expect(patchFor({ ...item, category: 'uncategorised' }, ['category'], context).extendedProperties).toBeUndefined()
  })
})

describe('newEventId', () => {
  it('only uses characters Google accepts for event ids', () => {
    const id = newEventId()
    expect(id).toHaveLength(26)
    expect(isEventId(id)).toBe(true)
    expect(newEventId(bytes => bytes.fill(255))).toBe('v'.repeat(26))
  })
})
