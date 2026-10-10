import { onAuthStateChanged, signOut } from 'firebase/auth'
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

/** Whether every change this device made has reached the server within `ms`. */
const sentWithin = (ms: number) => Promise.race([
  waitForPendingWrites(db).then(() => true, () => false),
  new Promise<boolean>(resolve => {
    setTimeout(() => resolve(false), ms)
  }),
])

/**
 * The household's data must not stay on the device after sign-out (#114): Firestore's offline cache
 * lives in IndexedDB, readable by whoever uses this browser next. It is deleted and the page reloads
 * with a fresh, empty cache. Another open tab of the app is closed by Firestore along the way.
 */
const forgetCachedData = async () => {
  await terminate(db)
  await clearIndexedDbPersistence(db).catch(() => null)
  globalThis.location.reload()
}

let signingOut = false

/**
 * Signs out of the app, after every feature has dropped what it kept for this person. Changes not yet
 * on the server get a moment to arrive first, while still signed in (they need the account). If they
 * can't (offline), the cache stays, so they aren't lost: the next sign-in on this device sends them.
 */
export const signOutOfApp = async () => {
  signingOut = true
  const sent = await sentWithin(PENDING_WRITES_GRACE_MS)
  for (const handler of handlers) {
    handler()
  }
  await signOut(auth)
  if (sent) {
    await forgetCachedData()
  }
  signingOut = false
}

// A session can also end without the button (an account removed or its sessions revoked): then the
// cache goes too. The writes it may still hold can't be sent any more without an account.
let signedIn = false
onAuthStateChanged(auth, user => {
  const ended = signedIn && !user && !signingOut
  signedIn = Boolean(user)
  if (ended) {
    forgetCachedData().catch(() => null)
  }
})
