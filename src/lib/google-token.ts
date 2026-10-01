// Google Calendar access tokens from Google Identity Services (GIS). Tokens live only in memory and
// Last about an hour; there is no refresh token anywhere (README section 3.1).

const GIS_SCRIPT = 'https://accounts.google.com/gsi/client'
const CALENDAR = 'https://www.googleapis.com/auth/calendar'

/** What every household member grants: edit events, and manage their own calendar list. */
export const MEMBER_SCOPES = [`${CALENDAR}.events`, `${CALENDAR}.calendarlist`] as const
/** The owner additionally creates and shares the household calendar. */
export const OWNER_SCOPES = [...MEMBER_SCOPES, `${CALENDAR}.app.created`] as const

export interface TokenResponse {
  access_token: string
  expires_in: number
  scope: string
  error?: string
}

interface TokenClient {
  requestAccessToken: (overrides?: { prompt?: string }) => void
}

declare global {
  interface Window {
    google?: {
      accounts: {
        oauth2: {
          initTokenClient: (config: {
            client_id: string
            scope: string
            include_granted_scopes: boolean
            hint?: string
            callback: (response: TokenResponse) => void
            error_callback: (error: { type: string, message?: string }) => void
          }) => TokenClient
        }
      }
    }
  }
}

export interface Token {
  value: string
  /** `performance.now()` deadline; a monotonic clock, unaffected by the wall clock. */
  usableUntil: number
  scopes: Set<string>
}

const REFRESH_MARGIN_MS = 2 * 60_000

let current: Token | null = null
let pending: Promise<Token> | null = null
let gisLoaded: Promise<void> | null = null

/**
 * Loads the Google Identity Services script. Settings calls this on mount so that, when a button is
 * clicked, the consent popup opens straight away: a popup opened too long after the click is
 * blocked, especially on iOS Safari.
 */
export function loadGis(): Promise<void> {
  if (window.google?.accounts.oauth2) {
    return Promise.resolve()
  }
  gisLoaded ??= new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = GIS_SCRIPT
    script.async = true
    script.addEventListener('load', () => resolve())
    script.addEventListener('error', () => reject(new Error('Could not load Google sign-in')))
    document.head.append(script)
  })
  return gisLoaded
}

const covers = (token: Token, scopes: readonly string[]) => scopes.every(scope => token.scopes.has(scope))

function requestToken(scopes: readonly string[], hint?: string | null): Promise<TokenResponse> {
  const oauth2 = window.google?.accounts.oauth2
  if (!oauth2) {
    return Promise.reject(new Error('Google sign-in is unavailable'))
  }
  return new Promise((resolve, reject) => {
    oauth2.initTokenClient({
      callback: resolve,
      client_id: import.meta.env.VITE_GOOGLE_CLIENT_ID,
      error_callback: error => reject(new Error(popupProblem(error))),
      ...(hint ? { hint } : {}),
      include_granted_scopes: true,
      scope: scopes.join(' '),
    }).requestAccessToken({ prompt: '' })
  })
}

function popupProblem(error: { type: string, message?: string }): string {
  switch (error.type) {
    case 'popup_failed_to_open': {
      return 'The Google window could not open. Allow pop-ups for this site and try again.'
    }
    case 'popup_closed': {
      return 'The Google window was closed before access was granted.'
    }
    default: {
      return error.message ?? error.type
    }
  }
}

/** Checks a GIS token response; exported for tests. */
export function acceptToken(response: TokenResponse, scopes: readonly string[]): Token {
  if (response.error) {
    throw new Error(`Google refused Calendar access: ${response.error}`)
  }
  const granted = new Set(response.scope.split(' '))
  const missing = scopes.filter(scope => !granted.has(scope))
  if (missing.length > 0) {
    throw new Error(`Calendar access is incomplete. Please allow every permission (missing: ${missing.join(', ')})`)
  }
  return {
    scopes: granted,
    usableUntil: performance.now() + response.expires_in * 1000 - REFRESH_MARGIN_MS,
    value: response.access_token,
  }
}

/**
 * Returns an access token covering `scopes`, asking Google only when the cached one is missing,
 * too narrow, or about to expire. Call it from a click handler the first time: Google may need to
 * show its consent popup.
 */
export async function calendarToken(scopes: readonly string[], hint?: string | null): Promise<string> {
  // Performance.now() stops while some phones sleep, so a token can outlive this check; the API
  // Wrapper then gets a 401, calls forgetCalendarToken() and asks again.
  if (current && covers(current, scopes) && performance.now() < current.usableUntil) {
    return current.value
  }
  // One request at a time: parallel callers share it instead of opening several Google windows.
  pending ??= loadGis()
    .then(() => requestToken(scopes, hint))
    .then(response => acceptToken(response, scopes))
    .finally(() => {
      pending = null
    })
  current = await pending
  return current.value
}

/** Forgets the cached token, e.g. on sign-out. */
export function forgetCalendarToken() {
  current = null
}
