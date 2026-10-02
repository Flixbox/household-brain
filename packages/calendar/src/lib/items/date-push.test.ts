import { describe, expect, it } from 'vitest'
import { DEFAULT_CATEGORIES } from '../categories'
import { type CalendarApi, CalendarApiError } from '../calendar/api'
import { deleteDateEvents, pushDateOp } from './date-push'
import type { CalendarEvent } from './event'
import type { Item } from './model'

const config = { calendarId: 'cal-1', ownerUid: 'owner', timeZone: 'Europe/Berlin' }
const item = { dateEvents: { aaaaaaaa: { shape: 'x' } }, extraDates: [{ date: '2099-01-01', id: 'bbbbbbbb', label: 'Renews' }], id: 'eeeeeeeeeeeeeeeeeeeeeeeeee' } as unknown as Item

const fakeApi = (insertStatus?: number, patchStatuses: number[] = []) => {
  const calls: string[] = []
  const api = {
    deleteEvent: async (_calendarId: string, eventId: string) => {
      calls.push(`delete ${eventId}`)
    },
    getEvent: async (_calendarId: string, eventId: string) => {
      calls.push(`get ${eventId}`)
      return { etag: '"current"', id: eventId, status: 'cancelled' }
    },
    insertEvent: async (_calendarId: string, event: CalendarEvent) => {
      calls.push(`insert ${event.id}`)
      if (insertStatus) {
        throw new CalendarApiError(insertStatus, 'insert failed')
      }
      return event
    },
    patchEvent: async (target: { eventId: string }, patch: CalendarEvent, etag: string) => {
      calls.push(`patch ${target.eventId} ${patch.status} ${'id' in patch ? 'with id' : 'without id'} start.date ${String(patch.start?.date)} if ${etag}`)
      const status = patchStatuses.shift()
      if (status) {
        throw new CalendarApiError(status, 'patch failed')
      }
      return patch
    },
  } as unknown as CalendarApi
  return { calls, context: { api, categories: DEFAULT_CATEGORIES, config, uid: 'owner' } }
}

const upsert = { dateId: 'bbbbbbbb', event: { id: 'eeeeeeeeeeeeeeeeeeeeeeeeeedbbbbbbbb', start: { dateTime: '2099-01-01T17:00:00' }, summary: 'x' }, kind: 'upsert', shape: 's' } as const

describe('pushDateOp', () => {
  it('inserts a new date event', async () => {
    const { calls, context } = fakeApi()
    await pushDateOp(context, item, upsert)
    expect(calls).toEqual(['insert eeeeeeeeeeeeeeeeeeeeeeeeeedbbbbbbbb'])
  })

  it('writes an existing one in full on 409, bringing a deleted one back', async () => {
    const { calls, context } = fakeApi(409)
    await pushDateOp(context, item, upsert)
    expect(calls).toEqual(['insert eeeeeeeeeeeeeeeeeeeeeeeeeedbbbbbbbb', 'get eeeeeeeeeeeeeeeeeeeeeeeeeedbbbbbbbb', 'patch eeeeeeeeeeeeeeeeeeeeeeeeeedbbbbbbbb confirmed without id start.date null if "current"'])
  })

  it('reads and patches once more when someone else wrote it in between (412)', async () => {
    const { calls, context } = fakeApi(409, [412])
    await pushDateOp(context, item, upsert)
    expect(calls.filter(call => call.startsWith('patch'))).toHaveLength(2)
    expect(calls.filter(call => call.startsWith('get'))).toHaveLength(2)
  })

  it('passes other failures on', async () => {
    const { context } = fakeApi(403)
    await expect(pushDateOp(context, item, upsert)).rejects.toThrow('insert failed')
  })

  it('deletes a removed date event', async () => {
    const { calls, context } = fakeApi()
    await pushDateOp(context, item, { dateId: 'aaaaaaaa', kind: 'delete' })
    expect(calls).toEqual(['delete eeeeeeeeeeeeeeeeeeeeeeeeeedaaaaaaaa'])
  })

  it("deletes every date event an entry may have: recorded ones and its current dates'", async () => {
    const { calls, context } = fakeApi()
    await deleteDateEvents(context, item)
    expect(calls).toEqual(['delete eeeeeeeeeeeeeeeeeeeeeeeeeedaaaaaaaa', 'delete eeeeeeeeeeeeeeeeeeeeeeeeeedbbbbbbbb'])
  })
})
