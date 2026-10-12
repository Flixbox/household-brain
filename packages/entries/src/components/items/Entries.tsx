import { useCategories, useItems } from '@household-brain/entries/lib/items/use-items'
import { ItemList } from './ItemList'

/** The household's entries by category, once they are loaded. */
export const Entries = () => {
  const items = useItems()
  const categories = useCategories()
  return items ? <ItemList items={items} categories={categories} /> : null
}
