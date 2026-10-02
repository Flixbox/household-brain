import { collection, doc, onSnapshot, orderBy, query } from 'firebase/firestore'
import { db } from '@household-brain/firebase/firebase'
import type { Category } from '@household-brain/calendar/lib/categories'
import type { HouseholdConfig } from '@household-brain/calendar/lib/calendar/setup'
import { $calendarToken } from '@household-brain/calendar/lib/google-token'
import { watchDateGate } from './date-outbox'
import type { Item } from './model'
import { itemsCollection } from './store'
import { categoryFrom, householdFrom, itemFrom } from '@household-brain/calendar/lib/documents'

const PULL_EVERY_MS = 60_000

interface Triggers {
  /** The entries, and the ids of those whose latest local write the server hasn't confirmed yet. */
  items: (items: Item[], pendingWrites: Set<string>) => unknown
  categories: (categories: Category[]) => unknown
  /** The household's calendar settings; null while there is no calendar yet. */
  config: (config: HouseholdConfig | null) => unknown
  /** The app versions in use changed (whether date events may be written). */
  dateGate: () => unknown
  /** The device came back online. */
  online: () => unknown
  /** Time to look for changes made directly in Google Calendar. */
  pull: () => unknown
  /** A token from another tab (shared through storage), or one forgotten after a 401. */
  tokenChanged: () => unknown
}

const ignore = () => null

const watchFirestore = (triggers: Triggers): (() => void)[] =>
  [
    onSnapshot(query(itemsCollection, orderBy('updatedAt')), { includeMetadataChanges: true }, snapshot => triggers.items(
      snapshot.docs.map(entry => itemFrom(entry.id, entry.data())),
      new Set(snapshot.docs.filter(entry => entry.metadata.hasPendingWrites).map(entry => entry.id)),
    ), ignore),
    onSnapshot(query(collection(db, 'categories'), orderBy('sortOrder')), snapshot =>
      triggers.categories(snapshot.docs.map(entry => categoryFrom(entry.id, entry.data()))), ignore),
    watchDateGate(triggers.dateGate),
    onSnapshot(doc(db, 'meta', 'config'), snapshot =>
      triggers.config(snapshot.exists() ? householdFrom(snapshot.data()) : null), ignore),
  ]

/**
 * What wakes the outbox: changes in Firestore, coming back online, a Calendar token arriving or
 * going, and pulls once a minute and whenever the app comes back to the foreground, while it is
 * visible. Returns the functions that stop each.
 */
export const watchOutboxTriggers = (triggers: Triggers): (() => void)[] => {
  const pullIfVisible = () => (document.visibilityState === 'visible' ? triggers.pull() : null)
  globalThis.addEventListener('online', triggers.online)
  document.addEventListener('visibilitychange', pullIfVisible)
  const every = setInterval(pullIfVisible, PULL_EVERY_MS)
  return [
    ...watchFirestore(triggers),
    $calendarToken.listen(() => triggers.tokenChanged()),
    () => globalThis.removeEventListener('online', triggers.online),
    () => document.removeEventListener('visibilitychange', pullIfVisible),
    () => clearInterval(every),
  ]
}
