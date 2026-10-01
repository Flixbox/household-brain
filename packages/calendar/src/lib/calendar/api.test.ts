import { describe, expect, it } from 'vitest'
import { createCalendarApi } from './api'

const respond = (...replies: { status: number, body?: unknown }[]) => {
  const requests: { url: string, init: RequestInit }[] = []
  const fetchFn = async (url: string, init: RequestInit) => {
    requests.push({ init, url })
    const reply = replies[Math.min(requests.length, replies.length) - 1]
    return new Response(reply.status === 204 ? null : JSON.stringify(reply.body ?? {}), { status: reply.status })
  }
  return { fetchFn, requests }
}

const tokens = (...values: string[]) => {
  let index = 0
  let forgotten = 0
  return {
    access: {
      forgetToken: () => {
        forgotten += 1
      },
      token: async () => {
        const value = values[Math.min(index, values.length - 1)]
        index += 1
        return value
      },
    },
    forgotten: () => forgotten,
  }
}

describe('createCalendarApi', () => {
  it('sends the bearer token and JSON body', async () => {
    const { fetchFn, requests } = respond({ body: { id: 'cal-1' }, status: 200 })
    const api = createCalendarApi(tokens('token-1').access, fetchFn)

    expect(await api.insertCalendar({ summary: 'Household Brain', timeZone: 'Europe/Berlin' })).toEqual({ id: 'cal-1' })
    expect(requests[0].url).toBe('https://www.googleapis.com/calendar/v3/calendars')
    expect(requests[0].init.method).toBe('POST')
    expect(new Headers(requests[0].init.headers).get('Authorization')).toBe('Bearer token-1')
    expect(JSON.parse(String(requests[0].init.body))).toEqual({ summary: 'Household Brain', timeZone: 'Europe/Berlin' })
  })

  it('adds a calendar to the list together with its reminders', async () => {
    const { fetchFn, requests } = respond({ body: { id: 'cal-1' }, status: 200 })
    await createCalendarApi(tokens('t').access, fetchFn).insertListEntry('cal-1', [{ method: 'popup', minutes: 1440 }])
    expect(JSON.parse(String(requests[0].init.body))).toEqual({ defaultReminders: [{ method: 'popup', minutes: 1440 }], id: 'cal-1' })
  })

  it('finds owned calendars by exact name', async () => {
    const items = [
      { accessRole: 'owner', id: 'a', summary: 'Household Brain' },
      { accessRole: 'owner', id: 'b', summary: 'Household Brain (old)' },
    ]
    const { fetchFn, requests } = respond({ body: { items }, status: 200 })
    expect(await createCalendarApi(tokens('t').access, fetchFn).findOwnedCalendars('Household Brain')).toEqual([items[0]])
    expect(requests[0].url).toContain('/users/me/calendarList?minAccessRole=owner')
  })

  it('escapes calendar ids and reports a calendar missing from the list as null', async () => {
    const { fetchFn, requests } = respond({ body: { error: { message: 'Not Found' } }, status: 404 })
    expect(await createCalendarApi(tokens('t').access, fetchFn).getListEntry('abc@group.calendar.google.com')).toBeNull()
    expect(requests[0].url).toBe('https://www.googleapis.com/calendar/v3/users/me/calendarList/abc%40group.calendar.google.com')
  })

  it('drops a rejected token and retries once with a fresh one', async () => {
    const { fetchFn, requests } = respond({ status: 401 }, { body: { id: 'cal-1' }, status: 200 })
    const access = tokens('stale', 'fresh')
    await createCalendarApi(access.access, fetchFn).insertCalendar({ summary: 'x', timeZone: 'Europe/Berlin' })
    expect(access.forgotten()).toBe(1)
    expect(requests.map(request => new Headers(request.init.headers).get('Authorization'))).toEqual(['Bearer stale', 'Bearer fresh'])
  })

  it('throws other failures with their status', async () => {
    const { fetchFn } = respond({ body: { error: { message: 'Forbidden' } }, status: 403 })
    await expect(createCalendarApi(tokens('t').access, fetchFn).insertCalendar({ summary: 'x', timeZone: 'Europe/Berlin' }))
      .rejects.toMatchObject({ name: 'CalendarApiError', status: 403 })
  })
})

describe('event calls', () => {
  it('patches with If-Match and treats a missing event as already deleted', async () => {
    const { fetchFn, requests } = respond({ body: { etag: '"v2"' }, status: 200 }, { status: 410 })
    const api = createCalendarApi(tokens('t').access, fetchFn)
    await api.patchEvent({ calendarId: 'cal-1', eventId: 'evt1' }, { summary: 'x' }, '"v1"')
    await api.deleteEvent('cal-1', 'evt1')
    expect(new Headers(requests[0].init.headers).get('If-Match')).toBe('"v1"')
    expect(requests[0].url).toBe('https://www.googleapis.com/calendar/v3/calendars/cal-1/events/evt1')
    expect(requests[1].init.method).toBe('DELETE')
  })
})
