import type { CalendarEvent } from '../items/event'

const BASE = 'https://www.googleapis.com/calendar/v3'

export class CalendarApiError extends Error {
  public readonly status: number

  public constructor(status: number, message: string) {
    super(message)
    this.name = 'CalendarApiError'
    this.status = status
  }
}

export interface Reminder {
  method: 'popup' | 'email'
  minutes: number
}

export interface CalendarListEntry {
  id: string
  summary?: string
  accessRole?: string
  defaultReminders?: Reminder[]
}

export interface EventTarget {
  calendarId: string
  eventId: string
}

/** The Google Calendar calls the app makes, behind one small interface so tests can fake it. */
export interface CalendarApi {
  insertCalendar: (calendar: { summary: string, timeZone: string, description?: string }) => Promise<{ id: string }>
  /** Calendars in the user's list that the user owns and that carry exactly this name. */
  findOwnedCalendars: (summary: string) => Promise<CalendarListEntry[]>
  getListEntry: (calendarId: string) => Promise<CalendarListEntry | null>
  insertListEntry: (calendarId: string, defaultReminders: Reminder[]) => Promise<CalendarListEntry>
  setDefaultReminders: (calendarId: string, reminders: Reminder[]) => Promise<void>
  insertEvent: (calendarId: string, event: CalendarEvent) => Promise<CalendarEvent>
  getEvent: (calendarId: string, eventId: string) => Promise<CalendarEvent>
  /** Fails with 412 when the event changed since `etag`. */
  patchEvent: (target: EventTarget, patch: CalendarEvent, etag: string) => Promise<CalendarEvent>
  /** Succeeds when the event is already gone. */
  deleteEvent: (calendarId: string, eventId: string) => Promise<void>
  /** One page of events, deleted ones included. Fails with 410 when `syncToken` has expired. */
  listEvents: (calendarId: string, cursor: EventCursor) => Promise<EventPage>
}

export interface EventCursor {
  syncToken?: string
  pageToken?: string
}

export interface EventPage {
  items?: CalendarEvent[]
  nextPageToken?: string
  nextSyncToken?: string
}

type Fetch = (input: string, init: RequestInit) => Promise<Response>

interface Access {
  token: () => Promise<string>
  /** Called when Google rejects the token (401), e.g. a cached token that expired while a phone slept. */
  forgetToken: () => void
}

interface ApiRequest {
  method: string
  path: string
  body?: unknown
  headers?: Record<string, string>
}

type Call = <Result>(request: ApiRequest) => Promise<Result>

const id = encodeURIComponent
const events = (calendarId: string) => `/calendars/${id(calendarId)}/events`
const event = (calendarId: string, eventId: string) => `${events(calendarId)}/${id(eventId)}`

const ignoreStatus = async (statuses: number[], action: () => Promise<unknown>): Promise<boolean> => {
  try {
    await action()
    return true
  } catch (error) {
    if (error instanceof CalendarApiError && statuses.includes(error.status)) {
      return false
    }
    throw error
  }
}

const createCall = (access: Access, fetchFn: Fetch): Call => {
  const send = async ({ method, path, body = null, headers = {} }: ApiRequest) => fetchFn(`${BASE}${path}`, {
    body: body === null ? null : JSON.stringify(body),
    headers: { 'Authorization': `Bearer ${await access.token()}`, 'Content-Type': 'application/json', ...headers },
    method,
  })
  return async <Result>(request: ApiRequest): Promise<Result> => {
    let response = await send(request)
    if (response.status === 401) {
      access.forgetToken()
      response = await send(request)
    }
    if (!response.ok) {
      const detail = await response.text()
      throw new CalendarApiError(response.status, `Google Calendar ${request.method} ${request.path} failed (${response.status}): ${detail}`)
    }
    return (response.status === 204 ? {} : await response.json()) as Result
  }
}

const calendarMethods = (call: Call) => ({
  findOwnedCalendars: async (summary: string) => {
    const list = await call<{ items?: CalendarListEntry[] }>({ method: 'GET', path: '/users/me/calendarList?minAccessRole=owner&maxResults=250' })
    return (list.items ?? []).filter(entry => entry.summary === summary)
  },
  getListEntry: async (calendarId: string) => {
    let entry: CalendarListEntry | null = null
    await ignoreStatus([404], async () => {
      entry = await call<CalendarListEntry>({ method: 'GET', path: `/users/me/calendarList/${id(calendarId)}` })
    })
    return entry
  },
  insertCalendar: (calendar: object) => call<{ id: string }>({ body: calendar, method: 'POST', path: '/calendars' }),
  insertListEntry: (calendarId: string, defaultReminders: Reminder[]) =>
    call<CalendarListEntry>({ body: { defaultReminders, id: calendarId }, method: 'POST', path: '/users/me/calendarList' }),
  setDefaultReminders: async (calendarId: string, reminders: Reminder[]) => {
    await call({ body: { defaultReminders: reminders }, method: 'PATCH', path: `/users/me/calendarList/${id(calendarId)}` })
  },
})

const eventMethods = (call: Call) => ({
  deleteEvent: async (calendarId: string, eventId: string) => {
    await ignoreStatus([404, 410], () => call({ method: 'DELETE', path: event(calendarId, eventId) }))
  },
  getEvent: (calendarId: string, eventId: string) => call<CalendarEvent>({ method: 'GET', path: event(calendarId, eventId) }),
  insertEvent: (calendarId: string, body: CalendarEvent) => call<CalendarEvent>({ body, method: 'POST', path: events(calendarId) }),
  listEvents: (calendarId: string, { syncToken, pageToken }: EventCursor) => {
    const query = new URLSearchParams({ maxResults: '250', showDeleted: 'true' })
    if (syncToken) {
      query.set('syncToken', syncToken)
    }
    if (pageToken) {
      query.set('pageToken', pageToken)
    }
    return call<EventPage>({ method: 'GET', path: `${events(calendarId)}?${query}` })
  },
  patchEvent: (target: EventTarget, body: CalendarEvent, etag: string) =>
    call<CalendarEvent>({ body, headers: { 'If-Match': etag }, method: 'PATCH', path: event(target.calendarId, target.eventId) }),
})

export const createCalendarApi = (access: Access, fetchFn: Fetch = (input, init) => fetch(input, init)): CalendarApi => {
  const call = createCall(access, fetchFn)
  return { ...calendarMethods(call), ...eventMethods(call) }
}
