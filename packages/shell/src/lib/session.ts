import { signOut } from 'firebase/auth'
import { clearIndexedDbPersistence, terminate, waitForPendingWrites } from 'firebase/firestore'
import { auth, db } from '@household-brain/firebase/firebase'

// Features keep their own per-person state (e.g. the calendar's Google token). The shell doesn't
// know them: each registers what must be forgotten at sign-out, and the app wires that up.
const handlers = new Set<() => void>()

/** Runs `handler` whenever someone signs out of the app. Returns the function that unregisters it. */
export const onSignOut = (handler: () => void): () => void => {
  handlers.add(handler)
  return () => handlers.delete(handler)
}

/** How long sign-out waits for changes still on their way to the server; offline, they can't arrive. */
const PENDING_WRITES_GRACE_MS = 5000

const settledWithin = (work: Promise<unknown>, ms: number) => Promise.race([
  work.catch(() => null),
  new Promise(resolve => {
    setTimeout(resolve, ms)
  }),
])

/**
 * The household's data must not stay on the device after sign-out (#114): Firestore's offline cache
 * lives in IndexedDB, readable by whoever uses this browser next. It is deleted, after changes still
 * on their way to the server got a moment to arrive, and the page reloads with a fresh, empty cache.
 * Another open tab of the app keeps the cache in use; then it goes when that tab is closed or signs out.
 */
const forgetCachedData = async () => {
  await settledWithin(waitForPendingWrites(db), PENDING_WRITES_GRACE_MS)
  await terminate(db)
  await clearIndexedDbPersistence(db).catch(() => null)
  globalThis.location.reload()
}

/** Signs out of the app, after every feature has dropped what it kept for this person. */
export const signOutOfApp = async () => {
  for (const handler of handlers) {
    handler()
  }
  await signOut(auth)
  await forgetCachedData()
}
