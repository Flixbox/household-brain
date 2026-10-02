// Google Calendar access tokens from Google Identity Services (GIS), separate from the Firebase
// sign-in. A token lasts about an hour and is kept in localStorage through a persistent store, so a
// reload doesn't lose it; there is no refresh token anywhere. The trade-off: injected script could
// read a calendar-only token that expires within the hour. A token belongs to the account it was
// asked for (the signed-in person's email as the hint) and is never used for another person.
// Scopes: `calendar.events` (not the narrower `calendar.app.created`, which may not cover a calendar
// another account owns) and `calendar.calendarlist` for everyone; the owner also grants
// `calendar.app.created` once, to create the household calendar. Sharing it would need
// `calendar.acls`, so it is done by hand instead (README).
import { persistentJSON } from '@nanostores/persistent'
import { Temporal } from 'temporal-polyfill'
import { holdUpdatesWhile } from './update-hold'

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
  /** The Google account (email) it was issued for: a token never serves another account. */
  account: string
  /**
   * Deadline in epoch milliseconds (`now()`). Wall-clock time, because it has to survive a reload;
   * should the clock be off, Google answers 401 and the API wrapper forgets the token and asks again.
   */
  usableUntil: number
  scopes: string[]
}

const REFRESH_MARGIN_MS = 2 * 60_000

/** The current token, kept across reloads; `null` when there is none. */
export const $calendarToken = persistentJSON<Token | null>('hb:calendar-token', null)

/** Wall-clock epoch milliseconds. Not `performance.now()`: that clock stops while some phones sleep. */
const now = () => Temporal.Now.instant().epochMilliseconds

let pending: Promise<Token> | null = null
let gisLoaded: Promise<void> | null = null

/**
 * Loads the Google Identity Services script. Settings calls this on mount so that, when a button is
 * clicked, the consent popup opens straight away: a popup opened too long after the click is
 * blocked, especially on iOS Safari.
 */
export const loadGis = (): Promise<void> => {
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

const usable = (token: Token | null, scopes: readonly string[], account: string | null | undefined): token is Token =>
  token !== null && Boolean(account) && token.account === account && now() < token.usableUntil && scopes.every(scope => token.scopes.includes(scope))

const requestToken = (scopes: readonly string[], hint?: string | null): Promise<TokenResponse> => {
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

const popupProblem = (error: { type: string, message?: string }): string => {
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
export const acceptToken = (response: TokenResponse, scopes: readonly string[], account: string): Token => {
  if (response.error) {
    throw new Error(`Google refused Calendar access: ${response.error}`)
  }
  const granted = new Set(response.scope.split(' '))
  const missing = scopes.filter(scope => !granted.has(scope))
  if (missing.length > 0) {
    throw new Error(`Calendar access is incomplete. Please allow every permission (missing: ${missing.join(', ')})`)
  }
  return {
    account,
    scopes: [...granted],
    usableUntil: now() + response.expires_in * 1000 - REFRESH_MARGIN_MS,
    value: response.access_token,
  }
}

/**
 * Returns an access token covering `scopes`, asking Google only when the cached one is missing,
 * too narrow, or about to expire. Call it from a click handler the first time: Google may need to
 * show its consent popup.
 */
export const calendarToken = async (scopes: readonly string[], account: string | null | undefined): Promise<string> => {
  const current = $calendarToken.get()
  if (usable(current, scopes, account)) {
    return current.value
  }
  // One request at a time: parallel callers share it instead of opening several Google windows.
  // The Google window can hide the app on a phone; no new version may load meanwhile.
  pending ??= holdUpdatesWhile(loadGis().then(() => requestToken(scopes, account)))
    .then(response => acceptToken(response, scopes, account ?? ''))
    .finally(() => {
      pending = null
    })
  const token = await pending
  $calendarToken.set(token)
  return token.value
}

/** Whether a usable token for `account` covering `scopes` is cached, so work can run without asking Google. */
export const hasCalendarToken = (scopes: readonly string[], account: string | null | undefined): boolean =>
  usable($calendarToken.get(), scopes, account)

/** Forgets the cached token, e.g. on sign-out or when Google rejects it. */
export const forgetCalendarToken = () => {
  $calendarToken.set(null)
}
