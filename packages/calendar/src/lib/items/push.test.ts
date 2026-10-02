import { describe, expect, it } from 'vitest'
import { DEFAULT_CATEGORIES } from '../categories'
import { type CalendarApi, CalendarApiError } from '../calendar/api'
import type { CalendarEvent } from './event'
import type { Item } from './model'
import { pushItem } from './push'

const config = { calendarId: 'cal-1', ownerUid: 'owner', timeZone: 'Europe/Berlin' }

const base: Item = {
  amount: '', category: 'coupon', code: '', currency: '', dirty: [], dueDate: '2026-11-03', etags: {}, id: 'evt1', notes: '',
  pendingOp: 'upsert', rev: 'r1', startDate: '', status: 'open', sync: 'pending', syncError: null, title: 'Amazon', url: '',
}

function fakeApi(behaviour: Partial<Record<'insert' | 'patch' | 'delete' | 'get', number[]>> = {}) {
  const calls: string[] = []
  const failNext = (kind: 'insert' | 'patch' | 'delete' | 'get') => {
    const status = behaviour[kind]?.shift()
    if (status) {
      throw new CalendarApiError(status, `${kind} failed`)
    }
  }
  const api = {
    deleteEvent: async (_calendarId: string, eventId: string) => {
      calls.push(`delete ${eventId}`)
      failNext('delete')
    },
    getEvent: async (_calendarId: string, eventId: string) => {
      calls.push(`get ${eventId}`)
      failNext('get')
      return { etag: '"current"', id: eventId, updated: '2026-10-02T18:00:00.000Z' }
    },
    insertEvent: async (_calendarId: string, event: CalendarEvent) => {
      calls.push(`insert ${event.id} ${event.summary}`)
      failNext('insert')
      return { ...event, etag: '"v1"' }
    },
    patchEvent: async (target: { eventId: string }, patch: CalendarEvent, etag: string) => {
      calls.push(`patch ${target.eventId} ${Object.keys(patch).toSorted().join(',')} if ${etag}`)
      failNext('patch')
      return { etag: '"v2"', id: target.eventId }
    },
  } as unknown as CalendarApi
  return { calls, context: (uid = 'owner') => ({ api, categories: DEFAULT_CATEGORIES, config, uid }) }
}

describe('pushItem', () => {
  it('inserts a new entry with its client-generated id', async () => {
    const { calls, context } = fakeApi()
    expect(await pushItem(context(), base)).toMatchObject({ event: { etag: '"v1"' }, kind: 'synced' })
    expect(calls).toEqual(['insert evt1 [Coupon] Amazon'])
  })

  it('treats 409 on insert as already created and reads the etag', async () => {
    const { calls, context } = fakeApi({ insert: [409] })
    expect(await pushItem(context(), base)).toMatchObject({ event: { etag: '"current"' }, kind: 'synced' })
    expect(calls).toEqual(['insert evt1 [Coupon] Amazon', 'get evt1'])
  })

  it('patches only the changed fields, guarded by the etag', async () => {
    const { calls, context } = fakeApi()
    const edited: Item = { ...base, dirty: ['dueDate'], etags: { owner: '"v1"' } }
    expect(await pushItem(context(), edited)).toMatchObject({ event: { etag: '"v2"' }, kind: 'synced' })
    expect(calls).toEqual(['patch evt1 end,start if "v1"'])
  })

  it('retries once against the current version after 412', async () => {
    const { calls, context } = fakeApi({ patch: [412] })
    const edited: Item = { ...base, dirty: ['title'], etags: { owner: '"old"' } }
    expect(await pushItem(context(), edited)).toMatchObject({ event: { etag: '"v2"' }, kind: 'synced' })
    expect(calls).toEqual(['patch evt1 colorId,summary if "old"', 'get evt1', 'patch evt1 colorId,summary if "current"'])
  })

  it('pushes the other person\'s edit to an event they never saw: read it, then patch', async () => {
    const { calls, context } = fakeApi({ insert: [409] })
    const edited: Item = { ...base, dirty: ['code'], etags: { partner: '"p1"' } }
    await pushItem(context(), edited)
    expect(calls).toEqual(['insert evt1 [Coupon] Amazon', 'get evt1', 'patch evt1 extendedProperties if "current"'])
  })

  it('writes an entry back when its event was deleted in Google', async () => {
    const { calls, context } = fakeApi({ insert: [409], patch: [410] })
    const edited: Item = { ...base, dirty: ['title'], etags: { owner: '"v1"' } }
    await pushItem(context(), edited)
    expect(calls).toEqual([
      'patch evt1 colorId,summary if "v1"',
      'insert evt1 [Coupon] Amazon',
      'get evt1',
      'patch evt1 colorId,description,end,extendedProperties,reminders,start,status,summary if "current"',
    ])
  })

  it('brings back an event deleted in Google when it was edited here meanwhile', async () => {
    const { calls, context } = fakeApi({ insert: [409], patch: [412] })
    const cancelledGet = context().api.getEvent
    let gets = 0
    const ctx = { ...context(), api: { ...context().api, getEvent: async (calendarId: string, eventId: string) => {
      gets += 1
      return { ...await cancelledGet(calendarId, eventId), ...gets === 1 ? { status: 'cancelled' } : {} }
    } } }
    await pushItem(ctx, { ...base, dirty: ['code'], etags: { owner: '"v1"' } })
    expect(calls).toEqual([
      'patch evt1 extendedProperties if "v1"',
      'get evt1',
      'insert evt1 [Coupon] Amazon',
      'get evt1',
      'patch evt1 colorId,description,end,extendedProperties,reminders,start,status,summary if "current"',
    ])
  })

  it('patches local edits onto an existing event even when no etag was ever recorded here', async () => {
    const { calls, context } = fakeApi({ insert: [409] })
    await pushItem(context(), { ...base, dirty: ['code'], etags: {} })
    expect(calls).toEqual(['insert evt1 [Coupon] Amazon', 'get evt1', 'patch evt1 extendedProperties if "current"'])
  })

  it('deletes, and other failures surface', async () => {
    const { calls, context } = fakeApi({ insert: [500] })
    expect(await pushItem(context(), { ...base, pendingOp: 'delete' })).toEqual({ kind: 'deleted' })
    await expect(pushItem(context(), base)).rejects.toMatchObject({ status: 500 })
    expect(calls[0]).toBe('delete evt1')
  })
})

describe('pushItem for an entry without a due date', () => {
  it('writes no event for a new one', async () => {
    const { calls, context } = fakeApi()
    // A new entry has every field dirty, but was never in Google: no call at all.
    expect(await pushItem(context(), { ...base, dirty: ['dueDate', 'title'], dueDate: '' })).toEqual({ kind: 'unscheduled', updated: '' })
    expect(calls).toEqual([])
  })

  it('deletes the event of one whose date was just removed', async () => {
    const { calls, context } = fakeApi()
    const outcome = await pushItem(context(), { ...base, dirty: ['dueDate'], dueDate: '', etags: { owner: '"v1"' }, googleUpdated: '2026-10-01T10:00:00.000Z' })
    expect(outcome).toEqual({ kind: 'unscheduled', updated: '2026-10-02T18:00:00.000Z' })
    expect(calls).toEqual(['delete evt1', 'get evt1'])
  })

  it('takes a missing event as gone, but retries when reading the deletion time fails for another reason', async () => {
    const removed: Item = { ...base, dirty: ['dueDate'], dueDate: '', etags: { owner: '"v1"' }, googleUpdated: '2026-10-01T10:00:00.000Z' }
    expect(await pushItem(fakeApi({ get: [404] }).context(), removed)).toEqual({ kind: 'unscheduled', updated: '' })
    await expect(pushItem(fakeApi({ get: [503] }).context(), removed)).rejects.toThrow('get failed')
  })
})
