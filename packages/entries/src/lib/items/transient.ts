import { CalendarApiError } from '@household-brain/entries/lib/calendar/api'
import { stringify } from '@household-brain/core/lib/stringify'

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

/**
 * A pull's failure on one event: a transient one is thrown again, so the pull fails and is retried;
 * any other becomes `what: why`, reported while the pull goes on.
 */
export const reportUnlessTransient = (what: string, error: unknown): string => {
  if (isTransient(error)) {
    throw error
  }
  return `${what}: ${stringify(error)}`
}
