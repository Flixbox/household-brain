import { Link } from '@tanstack/react-router'
import type { Category } from '../../lib/categories'
import type { Item } from '../../lib/items/model'
import { ItemRow } from './ItemRow'

const byDueDate = (left: Item, right: Item) => left.dueDate.localeCompare(right.dueDate) || left.title.localeCompare(right.title)

/** Entries grouped by category, each group sorted by due date. Deleted entries waiting to sync are hidden. */
export function ItemList({ items, categories }: { items: Item[], categories: Category[] }) {
  const visible = items.filter(item => item.pendingOp !== 'delete')
  return (
    <div className="space-y-6">
      {categories.map(category => (
        <section key={category.slug} aria-label={category.label} className="space-y-1">
          <div className="flex items-baseline justify-between">
            <h2 className="text-lg font-semibold">{category.label}</h2>
            <Link to="/items/new" search={{ category: category.slug }} aria-label={`Add ${category.label}`} className="text-xl font-semibold text-orange-700 dark:text-orange-400">+</Link>
          </div>
          <ul>
            {visible.filter(item => item.category === category.slug).toSorted(byDueDate).map(item => <ItemRow key={item.id} item={item} />)}
          </ul>
        </section>
      ))}
    </div>
  )
}
