import { auth } from '@household-brain/firebase/firebase'
import { MEMBER_SCOPES, OWNER_SCOPES, TASKS_SCOPE, calendarToken, forgetCalendarToken } from '@household-brain/entries/lib/google-token'
import { createCalendarApi } from './api'
import { type HouseholdConfig, createHousehold, joinHousehold } from './setup'
import { firestoreHouseholdStore } from './store'

const email = () => auth.currentUser?.email

const apiFor = (scopes: readonly string[]) => createCalendarApi({
  forgetToken: forgetCalendarToken,
  token: () => calendarToken(scopes, email()),
})

/** Owner: creates the household calendar (once) and connects the owner's own account. */
export const setUpHousehold = async (): Promise<string> => {
  const uid = auth.currentUser?.uid
  if (!uid) {
    throw new Error('Sign in first.')
  }
  // Ask Google first, while the click is fresh, so the consent popup is not blocked.
  await calendarToken(OWNER_SCOPES, email(), [TASKS_SCOPE])
  await createHousehold(apiFor(OWNER_SCOPES), firestoreHouseholdStore, uid)
  return 'The Household Brain calendar is ready, and your notifications are set to 2 days and 1 day before.'
}

/** Anyone: adds the household calendar to their Google Calendar with the two reminders. */
export const connectToHousehold = async (config: HouseholdConfig): Promise<string> => {
  await calendarToken(MEMBER_SCOPES, email(), [TASKS_SCOPE])
  const changed = await joinHousehold(apiFor(MEMBER_SCOPES), config)
  return changed
    ? 'Connected: the calendar is in your Google Calendar, with notifications 2 days and 1 day before.'
    : 'Already connected, with notifications 2 days and 1 day before.'
}
