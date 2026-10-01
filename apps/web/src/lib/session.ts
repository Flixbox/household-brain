import { signOut } from 'firebase/auth'
import { auth } from '@household-brain/firebase'
import { forgetCalendarToken } from '@household-brain/calendar'

/** Signs out of the app and drops the in-memory Calendar token with it. */
export async function signOutOfApp() {
  forgetCalendarToken()
  await signOut(auth)
}
