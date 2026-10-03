import { collection, onSnapshot } from 'firebase/firestore'
import { db } from '@household-brain/firebase/firebase'
import { missingDefaults } from '@household-brain/calendar/lib/categories'
import { firestoreHouseholdStore } from './store'
import { pruneCollapsed } from '@household-brain/calendar/lib/items/collapsed'
import { categoryFrom } from '@household-brain/calendar/lib/documents'

const ignore = () => null

/**
 * Keeps this device in line with the household's categories, acting only on the server's answer
 * (the offline cache may simply not know every category yet):
 * - adds default categories a set-up household doesn't have yet (one added to the defaults after the
 *   household was set up); two devices adding the same category is harmless. Retired defaults are
 *   only hidden, never deleted (`visibleCategories`);
 * - forgets collapsed categories that no longer exist. Against the full list, not the visible one,
 *   so a hidden retired category keeps its collapsed state.
 */
export const watchDefaultCategories = (): () => void =>
  // With metadata changes, so the server's confirmation of an unchanged cached list arrives too.
  onSnapshot(collection(db, 'categories'), { includeMetadataChanges: true }, snapshot => {
    if (snapshot.metadata.fromCache) {
      return
    }
    const categories = snapshot.docs.map(entry => categoryFrom(entry.id, entry.data()))
    if (categories.length > 0) {
      pruneCollapsed(categories.map(category => category.slug))
    }
    const missing = missingDefaults(categories)
    if (missing.length > 0) {
      firestoreHouseholdStore.saveCategories(missing).catch(ignore)
    }
  }, ignore)
