import { describe, expect, it } from 'vitest'
import type { Item } from './model'
import { errorFor, recordFor } from './record'

const pushed = { etags: {}, id: 'evt1', rev: 'r1' } as unknown as Item

describe('recordFor', () => {
  it('marks an unchanged entry synced and stores the etag for this user', () => {
    expect(recordFor({ latest: pushed, outcome: { event: { etag: '"v1"' }, kind: 'synced' }, pushed, remote: null, uid: 'owner' })).toEqual({
      fields: { 'dirty': [], 'etags.owner': '"v1"', 'googleUpdated': '', 'pendingOp': null, 'sync': 'synced', 'syncError': null },
      kind: 'update',
    })
  })

  it('keeps an entry edited during the push pending, with the new etag and only its newer edits', () => {
    const sent = { ...pushed, code: 'A', dirty: ['code', 'dueDate'], dueDate: '2026-12-24' } as Item
    const edited = { ...sent, code: 'B', dirty: ['code', 'dueDate'], rev: 'r2' } as Item
    expect(recordFor({ latest: edited, outcome: { event: { etag: '"v1"' }, kind: 'synced' }, pushed: sent, remote: null, uid: 'owner' }))
      .toEqual({ fields: { 'dirty': ['code'], 'etags.owner': '"v1"' }, kind: 'update' })
  })

  it('takes every field from Google\'s reply, including changes made in Google meanwhile', () => {
    const remote = { amount: '', category: 'coupon', code: 'MINE', currency: '', dueDate: '2026-12-27', interval: '', notes: '', reminders: '', startDate: '', status: 'open' as const, title: 'Cinema', url: '' }
    const record = recordFor({ latest: pushed, outcome: { event: { etag: '"v2"' }, kind: 'synced' }, pushed, remote, uid: 'owner' })
    expect(record).toMatchObject({ fields: { ...remote, 'etags.owner': '"v2"', 'sync': 'synced' }, kind: 'update' })
  })

  it('removes a deleted entry, unless it changed meanwhile', () => {
    expect(recordFor({ latest: pushed, outcome: { kind: 'deleted' }, pushed, remote: null, uid: 'owner' })).toEqual({ kind: 'delete' })
    expect(recordFor({ latest: { ...pushed, rev: 'r2' }, outcome: { kind: 'deleted' }, pushed, remote: null, uid: 'owner' })).toEqual({ kind: 'nothing' })
  })

  it('does nothing for an entry that no longer exists', () => {
    expect(recordFor({ latest: null, outcome: { event: { etag: '"v1"' }, kind: 'synced' }, pushed, remote: null, uid: 'owner' })).toEqual({ kind: 'nothing' })
  })
})

describe('errorFor', () => {
  it('records the error only if nothing changed meanwhile', () => {
    expect(errorFor(pushed, pushed, 'boom')).toEqual({ fields: { sync: 'error', syncError: 'boom' }, kind: 'update' })
    expect(errorFor({ ...pushed, rev: 'r2' }, pushed, 'boom')).toEqual({ kind: 'nothing' })
    expect(errorFor(null, pushed, 'boom')).toEqual({ kind: 'nothing' })
  })
})

describe('recordFor an entry without a due date', () => {
  it('has no event any more: no etags, synced, and the deletion time as its version', () => {
    expect(recordFor({ latest: pushed, outcome: { kind: 'unscheduled', updated: '2026-10-02T18:00:00.000Z' }, pushed, remote: null, uid: 'owner' })).toEqual({
      fields: { dirty: [], etags: {}, googleUpdated: '2026-10-02T18:00:00.000Z', pendingOp: null, sync: 'synced', syncError: null },
      kind: 'update',
    })
  })

  it('keeps a date added meanwhile pending, so its event is inserted next', () => {
    const sent = { ...pushed, dirty: ['dueDate'], dueDate: '' } as Item
    const dated = { ...sent, dueDate: '2026-12-24', rev: 'r2' } as Item
    expect(recordFor({ latest: dated, outcome: { kind: 'unscheduled', updated: '' }, pushed: sent, remote: null, uid: 'owner' }))
      .toEqual({ fields: { dirty: ['dueDate'], etags: {} }, kind: 'update' })
  })
})
