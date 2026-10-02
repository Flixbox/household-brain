import { signOut } from 'firebase/auth'
import { auth } from '@household-brain/firebase/firebase'

// Features keep their own per-person state (e.g. the calendar's Google token). The shell doesn't
// know them: each registers what must be forgotten at sign-out, and the app wires that up.
const handlers = new Set<() => void>()

/** Runs `handler` whenever someone signs out of the app. Returns the function that unregisters it. */
export const onSignOut = (handler: () => void): () => void => {
  handlers.add(handler)
  return () => handlers.delete(handler)
}

/** Signs out of the app, after every feature has dropped what it kept for this person. */
export const signOutOfApp = async () => {
  for (const handler of handlers) {
    handler()
  }
  await signOut(auth)
}
