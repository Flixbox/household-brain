import { doc, onSnapshot } from 'firebase/firestore'
import { useEffect, useState } from 'react'
import { db } from '@household-brain/firebase/firebase'
import type { HouseholdConfig } from './setup'

export type HouseholdState =
  | { state: 'loading' }
  | { state: 'missing' }
  | { state: 'ready', config: HouseholdConfig }

/** The household calendar settings (`meta/config`), kept live. */
export function useHousehold(): HouseholdState {
  const [household, setHousehold] = useState<HouseholdState>({ state: 'loading' })
  useEffect(() => onSnapshot(doc(db, 'meta', 'config'), snapshot => {
    setHousehold(snapshot.exists()
      ? { config: snapshot.data() as HouseholdConfig, state: 'ready' }
      : { state: 'missing' })
  }), [])
  return household
}
