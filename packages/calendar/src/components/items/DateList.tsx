import { Link } from '@tanstack/react-router'
import type { Category } from '../../lib/categories'
import type { Item } from '../../lib/items/model'
import { ItemRow } from './ItemRow'

/**
 * "All by date": every listed entry in one list by due date, each labelled with its category. Its
 * header has the "+" the category headers have in the other view, without a category preselected.
 */
export function DateList({ items, categories }: { items: Item[], categories: Category[] }) {
  const labelOf = new Map(categories.map(category => [category.slug, category.label]))
  return (
    <section aria-label="All entries by date" className="space-y-1">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-lg font-semibold">All entries</h2>
        <Link to="/items/new" aria-label="Add entry" className="text-xl font-semibold text-orange-700 dark:text-orange-400">+</Link>
      </div>
      {items.length === 0 && <p className="px-3 text-stone-500">No entries yet.</p>}
      <ul>{items.map(item => <ItemRow key={item.id} item={item} category={labelOf.get(item.category) ?? 'Uncategorised'} />)}</ul>
    </section>
  )
}
