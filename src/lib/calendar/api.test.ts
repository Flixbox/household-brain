import { describe, expect, it } from 'vitest'
import { CalendarApiError, createCalendarApi } from './api'

const recorder = (status: number, body: unknown = {}) => {
  const requests: { url: string, init: RequestInit }[] = []
  const fetchFn = async (url: string, init: RequestInit) => {
    requests.push({ init, url })
    return new Response(status === 204 ? null : JSON.stringify(body), { status })
  }
  return { fetchFn, requests }
}

describe('createCalendarApi', () => {
  it('sends the bearer token and JSON body', async () => {
    const { fetchFn, requests } = recorder(200, { id: 'cal-1' })
    const api = createCalendarApi(async () => 'token-1', fetchFn)

    expect(await api.insertCalendar({ summary: 'Household Brain', timeZone: 'Europe/Berlin' })).toEqual({ id: 'cal-1' })
    expect(requests[0].url).toBe('https://www.googleapis.com/calendar/v3/calendars')
    expect(requests[0].init.method).toBe('POST')
    expect(new Headers(requests[0].init.headers).get('Authorization')).toBe('Bearer token-1')
    expect(JSON.parse(String(requests[0].init.body))).toEqual({ summary: 'Household Brain', timeZone: 'Europe/Berlin' })
  })

  it('shares as a writer and escapes the calendar id', async () => {
    const { fetchFn, requests } = recorder(200)
    await createCalendarApi(async () => 't', fetchFn).shareCalendar('abc@group.calendar.google.com', 'partner@household-brain.test')
    expect(requests[0].url).toBe('https://www.googleapis.com/calendar/v3/calendars/abc%40group.calendar.google.com/acl?sendNotifications=true')
    expect(JSON.parse(String(requests[0].init.body))).toEqual({ role: 'writer', scope: { type: 'user', value: 'partner@household-brain.test' } })
  })

  it('reports a calendar missing from the list as null', async () => {
    const { fetchFn } = recorder(404, { error: { message: 'Not Found' } })
    expect(await createCalendarApi(async () => 't', fetchFn).getListEntry('cal-1')).toBeNull()
  })

  it('throws other failures with their status', async () => {
    const { fetchFn } = recorder(403, { error: { message: 'Forbidden' } })
    await expect(createCalendarApi(async () => 't', fetchFn).insertCalendar({ summary: 'x', timeZone: 'Europe/Berlin' }))
      .rejects.toMatchObject({ name: 'CalendarApiError', status: 403 })
    expect(new CalendarApiError(500, 'x').status).toBe(500)
  })
})
