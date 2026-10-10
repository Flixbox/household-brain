import { useCategories, useItems } from './use-items'
import type { Item } from './model'
import type { Category } from '@household-brain/entries/lib/categories'

export type Entry =
  | { state: 'loading' }
  | { state: 'gone' }
  | { state: 'ready', item: Item, categories: Category[] }

/** One entry for the edit screen; "gone" once it is deleted (also while its deletion syncs). */
export const useEntry = (itemId: string): Entry => {
  const items = useItems()
  const categories = useCategories()
  const item = items?.find(entry => entry.id === itemId && entry.pendingOp !== 'delete')
  if (items && !item) {
    return { state: 'gone' }
  }
  return item && categories.length > 0 ? { categories, item, state: 'ready' } : { state: 'loading' }
}
