import type { Page, Route } from '@playwright/test'

export interface CalendarRequest {
  method: string
  path: string
  body: unknown
}

const CORS = {
  'access-control-allow-headers': 'authorization, content-type, if-match',
  'access-control-allow-methods': 'GET, POST, PATCH, DELETE',
  'access-control-allow-origin': '*',
}

/**
 * Replaces Google Identity Services with a stub that grants every requested scope, and the Google
 * Calendar API with an in-memory fake. Returns the Calendar requests the app made, for assertions.
 */
export async function mockGoogle(page: Page, calendarId = 'household@group.calendar.google.test') {
  await page.addInitScript(() => {
    Object.assign(window, {
      google: {
        accounts: {
          oauth2: {
            initTokenClient: (config: { scope: string, callback: (response: unknown) => void }) => ({
              requestAccessToken: () => setTimeout(() => config.callback({ access_token: 'e2e-token', expires_in: 3600, scope: config.scope }), 0),
            }),
          },
        },
      },
    })
  })
  await page.route('https://accounts.google.com/gsi/client', route => route.fulfill({ body: '', contentType: 'text/javascript' }))

  const requests: CalendarRequest[] = []
  const calendarList = new Map<string, Record<string, unknown>>()
  const events = new Map<string, Record<string, unknown>>()
  const listing = { refused: false }
  let version = 0
  const stored = (id: string, event: object) => {
    version += 1
    events.set(id, { ...event, etag: `"v${version}"`, id, updated: updatedAt(version) })
    return events.get(id)
  }
  const reply = (route: Route, status: number, body: unknown) => (status === 204
    ? route.fulfill({ headers: CORS, status })
    : route.fulfill({ body: JSON.stringify(body), contentType: 'application/json', headers: CORS, status }))

  await page.route('https://www.googleapis.com/calendar/v3/**', async route => {
    const request = route.request()
    if (request.method() === 'OPTIONS') {
      await route.fulfill({ headers: CORS, status: 204 })
      return
    }
    const path = decodeURIComponent(new URL(request.url()).pathname.replace('/calendar/v3', ''))
    const body: unknown = request.postData() ? request.postDataJSON() : null
    requests.push({ body, method: request.method(), path })

    const listPrefix = '/users/me/calendarList/'
    if (request.method() === 'GET' && path === '/users/me/calendarList') {
      await reply(route, 200, { items: [] })
    } else if (request.method() === 'POST' && path === '/calendars') {
      await reply(route, 200, { id: calendarId, ...body as object })
    } else if (request.method() === 'GET' && path.startsWith(listPrefix)) {
      const entry = calendarList.get(path.slice(listPrefix.length))
      await (entry ? reply(route, 200, entry) : reply(route, 404, { error: { message: 'Not Found' } }))
    } else if (request.method() === 'POST' && path === '/users/me/calendarList') {
      const entry = body as { id: string }
      calendarList.set(entry.id, entry)
      await reply(route, 200, entry)
    } else if (request.method() === 'PATCH' && path.startsWith(listPrefix)) {
      const id = path.slice(listPrefix.length)
      calendarList.set(id, { ...calendarList.get(id), ...body as object })
      await reply(route, 200, calendarList.get(id))
    } else if (path.includes('/events')) {
      await handleEvent({ body, events, listing, path, reply: (status, json) => reply(route, status, json), request, stored })
    } else {
      await reply(route, 501, { error: { message: `Not mocked: ${request.method()} ${path}` } })
    }
  })
  /** Changes made directly in Google Calendar, as another device or person would. */
  const google = {
    create: (event: Record<string, unknown> & { id: string }) => stored(event.id, event),
    delete: (id: string) => stored(id, { ...events.get(id), status: 'cancelled' }),
    edit: (id: string, changes: Record<string, unknown>) => stored(id, { ...events.get(id), ...changes }),
    /** Events that exist (Google keeps deleted ones as "cancelled"). */
    live: () => [...events.values()].filter(event => event.status !== 'cancelled'),
    /** Makes event listings fail with 503 (the app retries later), to control when pulls see changes. */
    refuseListings: (refused: boolean) => {
      listing.refused = refused
    },
  }
  return { events, google, requests }
}

interface EventCall {
  request: { method: () => string, headers: () => Record<string, string> }
  path: string
  body: unknown
  events: Map<string, Record<string, unknown>>
  listing: { refused: boolean }
  stored: (id: string, event: object) => Record<string, unknown> | undefined
  reply: (status: number, body: unknown) => Promise<void>
}

/** Insert, get, patch (honouring If-Match) and delete for the fake calendar's events. */
async function handleEvent({ request, path, body, events, listing, stored, reply }: EventCall) {
  const eventId = path.split('/events/')[1] ?? ''
  if (request.method() === 'GET' && !eventId && listing.refused) {
    await reply(503, { error: { message: 'Backend Error' } })
    return
  }
  if (request.method() === 'GET' && !eventId) {
    // A list: everything every time, deleted events included, with a sync token. Real incremental
    // listings return less, but the app treats both the same way.
    await reply(200, { items: [...events.values()], nextSyncToken: `sync-${events.size}` })
    return
  }
  const found = events.get(eventId)
  // Like Google: a deleted event can still be read (status "cancelled") and revived with a patch,
  // but not deleted again.
  const reachable = found && (found.status !== 'cancelled' || request.method() !== 'DELETE')
  const existing = reachable ? found : null
  const method = request.method()
  if (method === 'POST') {
    const { id } = body as { id: string }
    await (events.has(id) ? reply(409, { error: { message: 'duplicate' } }) : reply(200, stored(id, body as object)))
  } else if (!existing) {
    await reply(404, { error: { message: 'Not Found' } })
  } else if (method === 'GET') {
    await reply(200, existing)
  } else if (method === 'PATCH') {
    const ifMatch = request.headers()['if-match']
    if (ifMatch && ifMatch !== existing.etag) {
      await reply(412, { error: { message: 'Precondition Failed' } })
      return
    }
    const next = patched(existing, body as Record<string, unknown>)
    const invalid = invalidEvent(next)
    await (invalid ? reply(400, { error: { message: invalid } }) : reply(200, stored(eventId, next)))
  } else {
    stored(eventId, { ...existing, status: 'cancelled' })
    await reply(204, null)
  }
}

/** A deterministic RFC 3339 `updated` time that grows with every write. */
function updatedAt(version: number): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  return `2026-10-01T${pad(10 + Math.floor(version / 3600))}:${pad(Math.floor(version / 60) % 60)}:${pad(version % 60)}Z`
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

/** Google's patch semantics: nested objects merge, arrays are replaced, null removes a field. */
function patched(existing: Record<string, unknown>, changes: Record<string, unknown>): Record<string, unknown> {
  const merged = Object.entries(changes).map(([key, value]): [string, unknown] => {
    const before = existing[key]
    return [key, isObject(value) && isObject(before) ? patched(before, value) : value]
  })
  return Object.fromEntries([...Object.entries(existing), ...merged].filter(([key, value]) => value !== null && (key in changes ? changes[key] !== null : true)))
}

/** The two combinations Google rejects, which normalisation must avoid. */
function invalidEvent(event: Record<string, unknown>): string | null {
  const start = event.start as Record<string, unknown> | undefined
  const reminders = event.reminders as { useDefault?: boolean, overrides?: unknown[] } | undefined
  if (start?.date && start.dateTime) {
    return 'Invalid start time: both date and dateTime'
  }
  if (reminders?.useDefault && (reminders.overrides?.length ?? 0) > 0) {
    return 'Cannot specify both default reminders and overrides at the same time.'
  }
  return null
}
