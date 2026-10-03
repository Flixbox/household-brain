import { CalendarApiError } from '@household-brain/calendar/lib/calendar/api'

/** No Calendar token is cached; getting one needs a click ("Sync now"). */
export class NeedsAccessError extends Error {
  public constructor() {
    super('Google Calendar access is needed')
    this.name = 'NeedsAccessError'
  }
}

/** Failures worth retrying by themselves: no access yet, network, rate limits, server trouble. */
export const isTransient = (error: unknown): boolean => {
  if (error instanceof NeedsAccessError || !(error instanceof CalendarApiError)) {
    return true
  }
  return error.status === 403 || error.status === 429 || error.status >= 500
}
