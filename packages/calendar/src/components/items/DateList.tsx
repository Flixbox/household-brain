import type { Category } from '../../lib/categories'
import type { Item } from '../../lib/items/model'
import { ItemRow } from './ItemRow'

/** "All by date": every listed entry in one list by due date, each labelled with its category. */
export function DateList({ items, categories }: { items: Item[], categories: Category[] }) {
  const labelOf = new Map(categories.map(category => [category.slug, category.label]))
  return (
    <section aria-label="All entries by date">
      <ul>{items.map(item => <ItemRow key={item.id} item={item} category={labelOf.get(item.category) ?? 'Uncategorised'} />)}</ul>
    </section>
  )
}
