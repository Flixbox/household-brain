import { describe, expect, it } from 'vitest'
import { DEFAULT_CATEGORIES } from '@household-brain/calendar/lib/categories'
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
  pendingOp: null, reminders: '', rev: 'r1', startDate: '', status: 'open', sync: 'synced', syncError: null, title: 'Amazon', url: '',
}

const decide = (overrides: { entry?: Item | null, event?: CalendarEvent }) =>
  decidePull({ categories: DEFAULT_CATEGORIES, entry: 'entry' in overrides ? overrides.entry ?? null : entry, event: overrides.event ?? event, uid: 'owner' })

describe('decidePull', () => {
  it('skips our own write coming back', () => {
    expect(decide({ event: { ...event, etag: '"g1"' } })).toEqual({ kind: 'skip' })
  })

  it('creates an entry for an event made in Google Calendar', () => {
    const decision = decide({ entry: null, event: { ...event, updated: '2026-10-01T10:00:05.000Z' } })
    expect(decision).toMatchObject({ fields: { 'code': 'NEW', 'etags': {}, 'id': 'evt1', 'sync': 'synced', 'title': 'Amazon (from Google)' }, kind: 'create' })
    // Until someone's etag is recorded, the same version is adjusted again: a failed patch is retried.
    const created = { ...entry, etags: {}, googleUpdated: '2026-10-01T10:00:05.000Z' }
    expect(decide({ entry: created, event: { ...event, updated: '2026-10-01T10:00:05.000Z' } })).toMatchObject({ kind: 'update', normalise: true })
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
    expect(fields).toMatchObject({ dueDate: '2026-11-03', title: 'Amazon (from Google)' })
    expect(fields).not.toHaveProperty('sync')
    // This person's etag comes only once their own copy is checked, so an interrupted check runs again.
    expect(fields).not.toHaveProperty('etags.owner')
  })

  it("still has this person's own copy follow the merged entry (#74)", () => {
    // The other person marked it done while this person had an unsent edit of the code.
    const done = { ...event, extendedProperties: { private: { 'hb.category': 'coupon', 'hb.code': 'NEW', 'hb.status': 'done' } } }
    const editing = { ...entry, dirty: ['code' as const], pendingOp: 'upsert' as const, sync: 'pending' as const }
    expect(decide({ entry: editing, event: done })).toMatchObject({ draft: { code: 'OLD', status: 'done' }, kind: 'update', ownCopy: true })
    // This person's own unsent status wins in the draft as well.
    const reopened = { ...editing, dirty: ['status' as const], status: 'open' as const }
    expect(decide({ entry: reopened, event: done })).toMatchObject({ draft: { code: 'NEW', status: 'open' }, ownCopy: true })
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

  it('takes nothing from the version the entry already holds, and leaves this person\'s etag for after their own copy is checked', () => {
    const decision = decide({ entry: { ...entry, googleUpdated: '2026-10-01T10:00:05.000Z' }, event: { ...event, updated: '2026-10-01T10:00:05Z' } })
    expect(decision).toMatchObject({ fields: {}, kind: 'update', normalise: false, ownCopy: true })
  })

  it('reads an unchanged event again after the reading rules changed, and only when it now reads differently (#97)', () => {
    // Taken in before "[Deal]" named a category: the entry kept the tag in its title.
    const tagged = { ...event, etag: '"g1"', summary: '[Coupon] [Deal] Amazon' }
    const held = { ...entry, code: 'NEW', dueDate: '2026-11-03', title: '[Deal] Amazon' }
    const recheck = (overrides: { entry: Item, event: CalendarEvent }) =>
      decidePull({ categories: DEFAULT_CATEGORIES, entry: overrides.entry, event: overrides.event, recheck: true, uid: 'owner' })
    expect(decide({ entry: held, event: tagged })).toEqual({ kind: 'skip' })
    expect(recheck({ entry: held, event: tagged })).toMatchObject({ fields: { title: 'Amazon' }, kind: 'update', normalise: true })
    // One that reads the same is left as it is, and so is one with edits waiting to be sent.
    expect(recheck({ entry: { ...held, title: 'Amazon' }, event: { ...tagged, summary: '[Coupon] Amazon' } })).toEqual({ kind: 'skip' })
    expect(recheck({ entry: { ...held, dirty: ['title'], pendingOp: 'upsert', sync: 'pending' }, event: tagged })).not.toMatchObject({ normalise: true })
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
