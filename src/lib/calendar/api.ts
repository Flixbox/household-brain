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

/** The Google Calendar calls the app makes, behind one small interface so tests can fake it. */
export interface CalendarApi {
  insertCalendar: (calendar: { summary: string, timeZone: string, description?: string }) => Promise<{ id: string }>
  /** Calendars in the user's list that the user owns and that carry exactly this name. */
  findOwnedCalendars: (summary: string) => Promise<CalendarListEntry[]>
  getListEntry: (calendarId: string) => Promise<CalendarListEntry | null>
  insertListEntry: (calendarId: string, defaultReminders: Reminder[]) => Promise<CalendarListEntry>
  setDefaultReminders: (calendarId: string, reminders: Reminder[]) => Promise<void>
}

type Fetch = (input: string, init: RequestInit) => Promise<Response>

interface Access {
  token: () => Promise<string>
  /** Called when Google rejects the token (401), e.g. a cached token that expired while a phone slept. */
  forgetToken: () => void
}

export function createCalendarApi(access: Access, fetchFn: Fetch = (input, init) => fetch(input, init)): CalendarApi {
  async function send(method: string, path: string, body: unknown): Promise<Response> {
    return fetchFn(`${BASE}${path}`, {
      body: body === null ? null : JSON.stringify(body),
      headers: { 'Authorization': `Bearer ${await access.token()}`, 'Content-Type': 'application/json' },
      method,
    })
  }

  async function call<Result>(method: string, path: string, body: unknown = null): Promise<Result> {
    let response = await send(method, path, body)
    if (response.status === 401) {
      access.forgetToken()
      response = await send(method, path, body)
    }
    if (!response.ok) {
      const detail = await response.text()
      throw new CalendarApiError(response.status, `Google Calendar ${method} ${path} failed (${response.status}): ${detail}`)
    }
    return (response.status === 204 ? {} : await response.json()) as Result
  }

  const id = encodeURIComponent

  return {
    findOwnedCalendars: async summary => {
      const list = await call<{ items?: CalendarListEntry[] }>('GET', '/users/me/calendarList?minAccessRole=owner&maxResults=250')
      return (list.items ?? []).filter(entry => entry.summary === summary)
    },
    getListEntry: async calendarId => {
      try {
        return await call<CalendarListEntry>('GET', `/users/me/calendarList/${id(calendarId)}`)
      } catch (error) {
        if (error instanceof CalendarApiError && error.status === 404) {
          return null
        }
        throw error
      }
    },
    insertCalendar: calendar => call('POST', '/calendars', calendar),
    insertListEntry: (calendarId, defaultReminders) => call('POST', '/users/me/calendarList', { defaultReminders, id: calendarId }),
    setDefaultReminders: async (calendarId, reminders) => {
      await call('PATCH', `/users/me/calendarList/${id(calendarId)}`, { defaultReminders: reminders })
    },
  }
}
