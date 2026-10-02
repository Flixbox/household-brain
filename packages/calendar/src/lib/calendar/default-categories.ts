import { collection, onSnapshot } from 'firebase/firestore'
import { db } from '@household-brain/firebase/firebase'
import { type Category, missingDefaults } from '../categories'
import { firestoreHouseholdStore } from './store'

const ignore = () => null

/**
 * Adds default categories a set-up household doesn't have yet (one added to the defaults after the
 * household was set up). Acts only on the server's answer: the offline cache may simply not know
 * every category yet. Two devices adding the same category is harmless. Retired defaults are only
 * hidden, never deleted (`visibleCategories`).
 */
export function watchDefaultCategories(): () => void {
  // With metadata changes, so the server's confirmation of an unchanged cached list arrives too.
  return onSnapshot(collection(db, 'categories'), { includeMetadataChanges: true }, snapshot => {
    if (snapshot.metadata.fromCache) {
      return
    }
    const missing = missingDefaults(snapshot.docs.map(entry => entry.data() as Category))
    if (missing.length > 0) {
      firestoreHouseholdStore.saveCategories(missing).catch(ignore)
    }
  }, ignore)
}
