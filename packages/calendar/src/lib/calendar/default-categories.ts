import { collection, deleteDoc, doc, getDocsFromServer, limit, onSnapshot, query, where } from 'firebase/firestore'
import { db } from '@household-brain/firebase/firebase'
import { type Category, RETIRED_DEFAULTS, missingDefaults } from '../categories'
import { firestoreHouseholdStore } from './store'

const ignore = () => null

async function dropUnused(slug: string) {
  const used = await getDocsFromServer(query(collection(db, 'items'), where('category', '==', slug), limit(1)))
  if (used.empty) {
    await deleteDoc(doc(db, 'categories', slug))
  }
}

/**
 * Keeps a set-up household's categories in line with the defaults: adds one added to the defaults
 * later, and drops a retired default no entry uses. Acts only on the server's answer: the offline
 * cache may simply not know every category yet. Two devices doing the same is harmless.
 */
export function watchDefaultCategories(): () => void {
  return onSnapshot(collection(db, 'categories'), snapshot => {
    if (snapshot.metadata.fromCache) {
      return
    }
    const missing = missingDefaults(snapshot.docs.map(entry => entry.data() as Category))
    if (missing.length > 0) {
      firestoreHouseholdStore.saveCategories(missing).catch(ignore)
    }
    for (const entry of snapshot.docs) {
      if (RETIRED_DEFAULTS.includes(entry.id)) {
        dropUnused(entry.id).catch(ignore)
      }
    }
  }, ignore)
}
