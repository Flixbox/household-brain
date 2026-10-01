import { describe, expect, it } from 'vitest'
import { DEFAULT_CATEGORIES } from '../categories'
import { type CalendarApi, CalendarApiError } from '../calendar/api'
import type { CalendarEvent } from './event'
import type { Item } from './model'
import { pushItem } from './push'

const config = { calendarId: 'cal-1', ownerUid: 'owner', timeZone: 'Europe/Berlin' }

const base: Item = {
  amount: '', category: 'coupon', code: '', dirty: [], dueDate: '2026-11-03', etags: {}, id: 'evt1', notes: '',
  pendingOp: 'upsert', status: 'open', sync: 'pending', syncError: null, title: 'Amazon', url: '',
}

function fakeApi(behaviour: Partial<Record<'insert' | 'patch' | 'delete', number[]>> = {}) {
  const calls: string[] = []
  const failNext = (kind: 'insert' | 'patch' | 'delete') => {
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
      return { etag: '"current"', id: eventId }
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
    expect(await pushItem(context(), base)).toEqual({ etag: '"v1"', kind: 'synced' })
    expect(calls).toEqual(['insert evt1 [Coupon] Amazon'])
  })

  it('treats 409 on insert as already created and reads the etag', async () => {
    const { calls, context } = fakeApi({ insert: [409] })
    expect(await pushItem(context(), base)).toEqual({ etag: '"current"', kind: 'synced' })
    expect(calls).toEqual(['insert evt1 [Coupon] Amazon', 'get evt1'])
  })

  it('patches only the changed fields, guarded by the etag', async () => {
    const { calls, context } = fakeApi()
    const edited: Item = { ...base, dirty: ['dueDate'], etags: { owner: '"v1"' } }
    expect(await pushItem(context(), edited)).toEqual({ etag: '"v2"', kind: 'synced' })
    expect(calls).toEqual(['patch evt1 end,start if "v1"'])
  })

  it('retries once against the current version after 412', async () => {
    const { calls, context } = fakeApi({ patch: [412] })
    const edited: Item = { ...base, dirty: ['title'], etags: { owner: '"old"' } }
    expect(await pushItem(context(), edited)).toEqual({ etag: '"v2"', kind: 'synced' })
    expect(calls).toEqual(['patch evt1 colorId,summary if "old"', 'get evt1', 'patch evt1 colorId,summary if "current"'])
  })

  it('pushes the other person\'s edit to an event they never saw: read it, then patch', async () => {
    const { calls, context } = fakeApi({ insert: [409] })
    const edited: Item = { ...base, dirty: ['code'], etags: { partner: '"p1"' } }
    await pushItem(context(), edited)
    expect(calls).toEqual(['insert evt1 [Coupon] Amazon', 'get evt1', 'patch evt1 extendedProperties if "current"'])
  })

  it('deletes, and other failures surface', async () => {
    const { calls, context } = fakeApi({ insert: [500] })
    expect(await pushItem(context(), { ...base, pendingOp: 'delete' })).toEqual({ kind: 'deleted' })
    await expect(pushItem(context(), base)).rejects.toMatchObject({ status: 500 })
    expect(calls[0]).toBe('delete evt1')
  })
})
