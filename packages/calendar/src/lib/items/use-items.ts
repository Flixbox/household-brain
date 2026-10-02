import { collection, onSnapshot, orderBy, query } from 'firebase/firestore'
import { useEffect, useState } from 'react'
import type { Category } from '../categories'
import { db } from '@household-brain/firebase/firebase'
import type { Item } from './model'
import { itemsCollection } from './store'

/** All entries, kept live (from the offline cache first, then the server). */
export function useItems(): Item[] | null {
  const [items, setItems] = useState<Item[] | null>(null)
  useEffect(() => onSnapshot(itemsCollection, snapshot => {
    setItems(snapshot.docs.map(entry => entry.data() as Item))
  }), [])
  return items
}

/** The categories, in their display order. */
export function useCategories(): Category[] {
  const [categories, setCategories] = useState<Category[]>([])
  useEffect(() => onSnapshot(query(collection(db, 'categories'), orderBy('sortOrder')), snapshot => {
    setCategories(snapshot.docs.map(entry => entry.data() as Category))
  }), [])
  return categories
}
