import { describe, expect, it } from 'vitest'
import type { Item } from './model'
import { errorFor, recordFor } from './record'

const pushed = { etags: {}, id: 'evt1', rev: 'r1' } as unknown as Item

describe('recordFor', () => {
  it('marks an unchanged entry synced and stores the etag for this user', () => {
    expect(recordFor({ latest: pushed, outcome: { etag: '"v1"', kind: 'synced' }, pushed, uid: 'owner' })).toEqual({
      fields: { 'dirty': [], 'etags.owner': '"v1"', 'pendingOp': null, 'sync': 'synced', 'syncError': null },
      kind: 'update',
    })
  })

  it('keeps an entry edited during the push pending, with only the new etag', () => {
    const edited = { ...pushed, rev: 'r2' }
    expect(recordFor({ latest: edited, outcome: { etag: '"v1"', kind: 'synced' }, pushed, uid: 'owner' })).toEqual({ fields: { 'etags.owner': '"v1"' }, kind: 'update' })
  })

  it('removes a deleted entry, unless it changed meanwhile', () => {
    expect(recordFor({ latest: pushed, outcome: { kind: 'deleted' }, pushed, uid: 'owner' })).toEqual({ kind: 'delete' })
    expect(recordFor({ latest: { ...pushed, rev: 'r2' }, outcome: { kind: 'deleted' }, pushed, uid: 'owner' })).toEqual({ kind: 'nothing' })
  })

  it('does nothing for an entry that no longer exists', () => {
    expect(recordFor({ latest: null, outcome: { etag: '"v1"', kind: 'synced' }, pushed, uid: 'owner' })).toEqual({ kind: 'nothing' })
  })
})

describe('errorFor', () => {
  it('records the error only if nothing changed meanwhile', () => {
    expect(errorFor(pushed, pushed, 'boom')).toEqual({ fields: { sync: 'error', syncError: 'boom' }, kind: 'update' })
    expect(errorFor({ ...pushed, rev: 'r2' }, pushed, 'boom')).toEqual({ kind: 'nothing' })
    expect(errorFor(null, pushed, 'boom')).toEqual({ kind: 'nothing' })
  })
})
