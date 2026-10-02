import { collection, doc, getDoc, getDocs, limit, query, setDoc, writeBatch } from 'firebase/firestore'
import { db } from '@household-brain/firebase/firebase'
import type { HouseholdConfig, HouseholdStore } from './setup'

const configDoc = doc(db, 'meta', 'config')

/** The household settings in Firestore: `meta/config` and the `categories` collection. */
export const firestoreHouseholdStore: HouseholdStore = {
  config: async () => {
    const snapshot = await getDoc(configDoc)
    return snapshot.exists() ? snapshot.data() as HouseholdConfig : null
  },
  hasCategories: async () => !(await getDocs(query(collection(db, 'categories'), limit(1)))).empty,
  saveCategories: async categories => {
    const batch = writeBatch(db)
    for (const category of categories) {
      batch.set(doc(db, 'categories', category.slug), category)
    }
    await batch.commit()
  },
  saveConfig: config => setDoc(configDoc, config),
}
