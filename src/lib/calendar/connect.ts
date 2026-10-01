import { auth } from '../firebase'
import { MEMBER_SCOPES, OWNER_SCOPES, calendarToken } from '../google-token'
import { CalendarApiError, createCalendarApi } from './api'
import { type HouseholdConfig, createHousehold, joinHousehold } from './setup'
import { firestoreHouseholdStore } from './store'

const apiFor = (scopes: readonly string[]) => createCalendarApi(() => calendarToken(scopes, auth.currentUser?.email))

/** Owner: creates the household calendar (once) and connects the owner's own account. */
export async function setUpHousehold(): Promise<string> {
  await createHousehold(apiFor(OWNER_SCOPES), firestoreHouseholdStore, auth.currentUser?.uid ?? '')
  return 'The Household Brain calendar is ready, and your notifications are set to 2 days and 1 day before.'
}

/** Anyone: adds the household calendar to their Google Calendar with the two reminders. */
export async function connectToHousehold(config: HouseholdConfig): Promise<string> {
  const changed = await joinHousehold(apiFor(MEMBER_SCOPES), config)
  return changed
    ? 'Connected: the calendar is in your Google Calendar, with notifications 2 days and 1 day before.'
    : 'Already connected, with notifications 2 days and 1 day before.'
}

/** Owner: lets another Google account change events in the household calendar. */
export async function shareHousehold(config: HouseholdConfig, email: string): Promise<string> {
  try {
    await apiFor(OWNER_SCOPES).shareCalendar(config.calendarId, email)
  } catch (error) {
    if (error instanceof CalendarApiError && error.status === 403) {
      throw new Error('Google did not allow sharing from the app. Share "Household Brain" in Google Calendar '
        + '(Settings → the calendar → Share with specific people → Make changes to events).', { cause: error })
    }
    throw error
  }
  return `Shared with ${email}. They can now sign in here and connect.`
}
