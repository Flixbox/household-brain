import { signOut } from 'firebase/auth'
import { auth } from './firebase'
import { forgetCalendarToken } from './google-token'

/** Signs out of the app and drops the in-memory Calendar token with it. */
export async function signOutOfApp() {
  forgetCalendarToken()
  await signOut(auth)
}
