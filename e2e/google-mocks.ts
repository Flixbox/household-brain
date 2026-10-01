import type { Page, Route } from '@playwright/test'

export interface CalendarRequest {
  method: string
  path: string
  body: unknown
}

const CORS = {
  'access-control-allow-headers': 'authorization, content-type',
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
  const reply = (route: Route, status: number, body: unknown) =>
    route.fulfill({ body: JSON.stringify(body), contentType: 'application/json', headers: CORS, status })

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
    } else {
      await reply(route, 501, { error: { message: `Not mocked: ${request.method()} ${path}` } })
    }
  })
  return requests
}
