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
  amount: '', category: 'coupon', code: 'OLD', currency: '', dirty: [], dueDate: '2026-11-01', etags: { owner: '"g1"' }, id: 'evt1', notes: '',
  pendingOp: null, rev: 'r1', startDate: '', status: 'open', sync: 'synced', syncError: null, title: 'Amazon', url: '',
}

const decide = (overrides: { entry?: Item | null, event?: CalendarEvent }) =>
  decidePull({ categories: DEFAULT_CATEGORIES, entry: 'entry' in overrides ? overrides.entry ?? null : entry, event: overrides.event ?? event, uid: 'owner' })

describe('decidePull', () => {
  it('skips our own write coming back', () => {
    expect(decide({ event: { ...event, etag: '"g1"' } })).toEqual({ kind: 'skip' })
  })

  it('creates an entry for an event made in Google Calendar', () => {
    const decision = decide({ entry: null })
    expect(decision).toMatchObject({ fields: { 'code': 'NEW', 'etags': {}, 'id': 'evt1', 'sync': 'synced', 'title': 'Amazon (from Google)' }, kind: 'create' })
  })

  it('takes Google\'s version of an entry without local edits', () => {
    const replaced = decide({})
    expect(replaced).toMatchObject({ fields: { 'code': 'NEW', 'dueDate': '2026-11-03', 'sync': 'synced' }, kind: 'update', normalise: true })
    // Recorded only after the event was adjusted, so an interrupted pull adjusts it again.
    expect((replaced as { fields: object }).fields).not.toHaveProperty('etags.owner')
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

  it('ignores a listing older than what the entry already has, whatever the precision', () => {
    expect(decide({ entry: { ...entry, googleUpdated: '2026-10-01T10:00:05Z' }, event: { ...event, updated: '2026-10-01T10:00:04.999Z' } })).toEqual({ kind: 'skip' })
  })

  it('only remembers this person\'s etag for the version the entry already holds', () => {
    const decision = decide({ entry: { ...entry, googleUpdated: '2026-10-01T10:00:05.000Z' }, event: { ...event, updated: '2026-10-01T10:00:05Z' } })
    expect(decision).toMatchObject({ fields: { 'etags.owner': '"g2"' }, kind: 'update', normalise: false })
    expect(Object.keys((decision as { fields: object }).fields)).toEqual(['etags.owner'])
  })

  it('leaves repeating events alone until repeating entries exist', () => {
    expect(decide({ entry: null, event: { ...event, recurrence: ['RRULE:FREQ=YEARLY'] } })).toEqual({ kind: 'skip' })
    expect(decide({ entry: null, event: { ...event, recurringEventId: 'series1' } })).toEqual({ kind: 'skip' })
  })

  it('leaves an entry waiting to be deleted alone', () => {
    expect(decide({ entry: { ...entry, pendingOp: 'delete', sync: 'pending' } })).toEqual({ kind: 'skip' })
  })
})

describe('decidePull for an entry without a due date', () => {
  const balance = { ...entry, dueDate: '', etags: {}, googleUpdated: '2026-10-02T18:00:00.000Z' }

  it('keeps it when Google lists its event deleted (the app deleted it on purpose)', () => {
    expect(decide({ entry: balance, event: { ...event, status: 'cancelled', updated: '2026-10-02T18:00:00.000Z' } })).toEqual({ kind: 'skip' })
  })

  it('ignores a listing from before the date was removed, but takes the date back from a newer live event (e.g. restored)', () => {
    expect(decide({ entry: balance, event: { ...event, updated: '2026-10-01T09:00:00.000Z' } })).toEqual({ kind: 'skip' })
    expect(decide({ entry: balance, event: { ...event, updated: '2026-10-03T09:00:00.000Z' } })).toMatchObject({ draft: { dueDate: '2026-11-03' }, kind: 'update' })
  })

  it('still merges while its own change (e.g. removing the date) waits to be sent', () => {
    const pending = { ...balance, dirty: ['dueDate' as const], pendingOp: 'upsert' as const, sync: 'pending' as const }
    expect(decide({ entry: pending })).toMatchObject({ kind: 'update', normalise: false })
  })
})
