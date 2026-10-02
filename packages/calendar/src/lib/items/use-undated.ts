import { collection } from 'firebase/firestore'
import { useStore } from '@nanostores/react'
import { db } from '@household-brain/firebase/firebase'
import { dataOf, queryStore } from '@household-brain/firebase/live'
import { UNDATED_SCHEMA, everyAppHandles } from './date-events'

/** Each person's sync state: which app version they run, as far as it says (`schema`). */
const $syncStates = queryStore<{ schema?: unknown }>(collection(db, 'syncState'))

/**
 * Whether an entry may be saved without a due date: only once every person's app handles that. An
 * older version would take its missing event for a deletion and remove it, and can't show it (#33).
 */
export const useUndatedAllowed = () => everyAppHandles(dataOf(useStore($syncStates)) ?? [], UNDATED_SCHEMA)
