import { collection, onSnapshot } from 'firebase/firestore'
import { useStore } from '@nanostores/react'
import { db } from '@household-brain/firebase/firebase'
import { dataOf, liveStore } from '@household-brain/firebase/live'
import { UNDATED_SCHEMA, everyAppHandles } from './date-events'

/**
 * Each person's sync state: which app version they run, as far as it says (`schema`). Only the
 * server's answer counts (it stays loading before that): the local cache may hold just this person's
 * own document, which would open the gate wrongly.
 */
const $syncStates = liveStore<{ schema?: unknown }[]>((next, fail) =>
  onSnapshot(collection(db, 'syncState'), { includeMetadataChanges: true }, snapshot => {
    if (!snapshot.metadata.fromCache) {
      next(snapshot.docs.map(entry => entry.data()))
    }
  }, fail))

/**
 * Whether an entry may be saved without a due date: only once every person's app handles that. An
 * older version would take its missing event for a deletion and remove it, and can't show it (#33).
 */
export const useUndatedAllowed = () => everyAppHandles(dataOf(useStore($syncStates)) ?? [], UNDATED_SCHEMA)
