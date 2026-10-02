import { doc } from 'firebase/firestore'
import { useStore } from '@nanostores/react'
import { db } from '@household-brain/firebase/firebase'
import { docStore } from '@household-brain/firebase/live'
import type { HouseholdConfig } from './setup'

export type HouseholdState =
  | { state: 'loading' }
  | { state: 'missing' }
  | { state: 'ready', config: HouseholdConfig }

/** The household calendar settings (`meta/config`), live. */
const $household = docStore<HouseholdConfig>(doc(db, 'meta', 'config'))

/** The household calendar settings; loading until known (a failed listener keeps it loading, as before). */
export const useHousehold = (): HouseholdState => {
  const live = useStore($household)
  if (live.state !== 'ready') {
    return { state: 'loading' }
  }
  return live.data ? { config: live.data, state: 'ready' } : { state: 'missing' }
}
