import { collection, orderBy, query } from 'firebase/firestore'
import { useStore } from '@nanostores/react'
import { useMemo } from 'react'
import { type Category, visibleCategories } from '../categories'
import { db } from '@household-brain/firebase/firebase'
import { dataOf, queryStore } from '@household-brain/firebase/live'
import type { Item } from './model'
import { itemsCollection } from './store'

/** All entries, kept live (from the offline cache first, then the server); one listener for every reader. */
const $items = queryStore<Item>(itemsCollection)

/** The household's categories in their display order, live. */
const $categories = queryStore<Category>(query(collection(db, 'categories'), orderBy('sortOrder')))

/** All entries, or null until the first answer. */
export const useItems = (): Item[] | null => dataOf(useStore($items))

/** The categories to list and offer, in their display order (retired ones only while in use). */
export const useCategories = (): Category[] => {
  const categories = dataOf(useStore($categories))
  const items = useItems()
  return useMemo(() => visibleCategories(categories ?? [], items ?? []), [categories, items])
}
