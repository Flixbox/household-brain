import { createCalendarApi } from '@household-brain/calendar/lib/calendar/api'
import { auth } from '@household-brain/firebase/firebase'
import { MEMBER_SCOPES, calendarToken, forgetCalendarToken, hasCalendarToken } from '@household-brain/calendar/lib/google-token'
import { NeedsAccessError } from './transient'

/**
 * The Calendar API as the outbox uses it: it never asks Google for a token itself (that needs a
 * click), and fails with NeedsAccessError instead, which leaves the entry waiting for "Sync now".
 */
export const outboxApi = createCalendarApi({
  forgetToken: forgetCalendarToken,
  token: () => (hasCalendarToken(MEMBER_SCOPES, auth.currentUser?.email)
    ? calendarToken(MEMBER_SCOPES, auth.currentUser?.email)
    : Promise.reject(new NeedsAccessError())),
})
