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
  defaultReminders?: Reminder[]
}

/** The Google Calendar calls the app makes, behind one small interface so tests can fake it. */
export interface CalendarApi {
  insertCalendar: (calendar: { summary: string, timeZone: string, description?: string }) => Promise<{ id: string }>
  shareCalendar: (calendarId: string, email: string) => Promise<void>
  getListEntry: (calendarId: string) => Promise<CalendarListEntry | null>
  insertListEntry: (calendarId: string) => Promise<CalendarListEntry>
  setDefaultReminders: (calendarId: string, reminders: Reminder[]) => Promise<void>
}

type Fetch = (input: string, init: RequestInit) => Promise<Response>

export function createCalendarApi(token: () => Promise<string>, fetchFn: Fetch = (input, init) => fetch(input, init)): CalendarApi {
  async function call<Result>(method: string, path: string, body: unknown = null): Promise<Result> {
    const response = await fetchFn(`${BASE}${path}`, {
      body: body === null ? null : JSON.stringify(body),
      headers: { 'Authorization': `Bearer ${await token()}`, 'Content-Type': 'application/json' },
      method,
    })
    if (!response.ok) {
      const detail = await response.text()
      throw new CalendarApiError(response.status, `Google Calendar ${method} ${path} failed (${response.status}): ${detail}`)
    }
    return (response.status === 204 ? {} : await response.json()) as Result
  }

  const id = encodeURIComponent

  return {
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
    insertListEntry: calendarId => call('POST', '/users/me/calendarList', { id: calendarId }),
    setDefaultReminders: async (calendarId, reminders) => {
      await call('PATCH', `/users/me/calendarList/${id(calendarId)}`, { defaultReminders: reminders })
    },
    shareCalendar: async (calendarId, email) => {
      await call('POST', `/calendars/${id(calendarId)}/acl?sendNotifications=true`, {
        role: 'writer',
        scope: { type: 'user', value: email },
      })
    },
  }
}
