import { describe, expect, it } from 'vitest'
import { DEFAULT_CATEGORIES } from '../categories'
import type { CalendarEvent } from './event'
import type { Item } from './model'
import { decidePull } from './pull-plan'

const event: CalendarEvent = {
  end: { dateTime: '2026-11-03T17:15:00+01:00', timeZone: 'Europe/Berlin' },
  etag: '"g2"',
  extendedProperties: { private: { 'hb.category': 'coupon', 'hb.code': 'NEW' } },
  id: 'evt1',
  reminders: { useDefault: true },
  start: { dateTime: '2026-11-03T17:00:00+01:00', timeZone: 'Europe/Berlin' },
  summary: '[Coupon] Amazon (from Google)',
}

const entry: Item = {
  amount: '', category: 'coupon', code: 'OLD', dirty: [], dueDate: '2026-11-01', etags: { owner: '"g1"' }, id: 'evt1', notes: '',
  pendingOp: null, rev: 'r1', status: 'open', sync: 'synced', syncError: null, title: 'Amazon', url: '',
}

const decide = (overrides: { entry?: Item | null, event?: CalendarEvent }) =>
  decidePull({ categories: DEFAULT_CATEGORIES, entry: 'entry' in overrides ? overrides.entry ?? null : entry, event: overrides.event ?? event, uid: 'owner' })

describe('decidePull', () => {
  it('skips our own write coming back', () => {
    expect(decide({ event: { ...event, etag: '"g1"' } })).toEqual({ kind: 'skip' })
  })

  it('creates an entry for an event made in Google Calendar', () => {
    const decision = decide({ entry: null })
    expect(decision).toMatchObject({ fields: { 'code': 'NEW', 'etags': { owner: '"g2"' }, 'id': 'evt1', 'sync': 'synced', 'title': 'Amazon (from Google)' }, kind: 'create' })
  })

  it('takes Google\'s version of an entry without local edits', () => {
    expect(decide({})).toMatchObject({ fields: { 'code': 'NEW', 'dueDate': '2026-11-03', 'etags.owner': '"g2"', 'sync': 'synced' }, kind: 'update', normalise: true })
  })

  it('keeps fields edited locally and takes Google\'s for the rest', () => {
    const decision = decide({ entry: { ...entry, dirty: ['code'], pendingOp: 'upsert', sync: 'pending' } })
    expect(decision).toMatchObject({ kind: 'update', normalise: false })
    const { fields } = decision as { fields: Record<string, unknown> }
    expect(fields).not.toHaveProperty('code')
    expect(fields).toMatchObject({ 'dueDate': '2026-11-03', 'etags.owner': '"g2"', 'title': 'Amazon (from Google)' })
    expect(fields).not.toHaveProperty('sync')
  })

  it('deletes an entry whose event was deleted, unless it has unsent edits', () => {
    const cancelled = { ...event, status: 'cancelled' }
    expect(decide({ event: cancelled })).toEqual({ kind: 'delete' })
    expect(decide({ entry: { ...entry, pendingOp: 'upsert', sync: 'pending' }, event: cancelled })).toEqual({ kind: 'skip' })
    expect(decide({ entry: null, event: cancelled })).toEqual({ kind: 'skip' })
  })

  it('leaves an entry waiting to be deleted alone', () => {
    expect(decide({ entry: { ...entry, pendingOp: 'delete', sync: 'pending' } })).toEqual({ kind: 'skip' })
  })
})
