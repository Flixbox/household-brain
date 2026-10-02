import { describe, expect, it } from 'vitest'
import { DEFAULT_CATEGORIES } from '../categories'
import { type CalendarApi, CalendarApiError } from '../calendar/api'
import { deleteDateEvents, pushDateOp } from './date-push'
import type { CalendarEvent } from './event'
import type { Item } from './model'

const config = { calendarId: 'cal-1', ownerUid: 'owner', timeZone: 'Europe/Berlin' }
const item = { dateEvents: { aaaaaaaa: { shape: 'x' } }, extraDates: [{ date: '2099-01-01', id: 'bbbbbbbb', label: 'Renews' }], id: 'entry' } as unknown as Item

function fakeApi(insertStatus?: number) {
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
      calls.push(`patch ${target.eventId} ${patch.status} ${'id' in patch ? 'with id' : 'without id'} if ${etag}`)
      return patch
    },
  } as unknown as CalendarApi
  return { calls, context: { api, categories: DEFAULT_CATEGORIES, config, uid: 'owner' } }
}

const upsert = { dateId: 'bbbbbbbb', event: { id: 'entrydbbbbbbbb', summary: 'x' }, kind: 'upsert', shape: 's' } as const

describe('pushDateOp', () => {
  it('inserts a new date event', async () => {
    const { calls, context } = fakeApi()
    await pushDateOp(context, item, upsert)
    expect(calls).toEqual(['insert entrydbbbbbbbb'])
  })

  it('writes an existing one in full on 409, bringing a deleted one back', async () => {
    const { calls, context } = fakeApi(409)
    await pushDateOp(context, item, upsert)
    expect(calls).toEqual(['insert entrydbbbbbbbb', 'get entrydbbbbbbbb', 'patch entrydbbbbbbbb confirmed without id if "current"'])
  })

  it('passes other failures on', async () => {
    const { context } = fakeApi(403)
    await expect(pushDateOp(context, item, upsert)).rejects.toThrow('insert failed')
  })

  it('deletes a removed date event', async () => {
    const { calls, context } = fakeApi()
    await pushDateOp(context, item, { dateId: 'aaaaaaaa', kind: 'delete' })
    expect(calls).toEqual(['delete entrydaaaaaaaa'])
  })

  it("deletes every date event an entry may have: recorded ones and its current dates'", async () => {
    const { calls, context } = fakeApi()
    await deleteDateEvents(context, item)
    expect(calls).toEqual(['delete entrydaaaaaaaa', 'delete entrydbbbbbbbb'])
  })
})
