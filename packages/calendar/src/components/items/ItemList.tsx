import { useStore } from '@nanostores/react'
import { useEffect } from 'react'
import type { Category } from '../../lib/categories'
import type { Item } from '../../lib/items/model'
import { $collapsed, collapsedSlugs, pruneCollapsed } from '../../lib/items/collapsed'
import { CategorySection } from './CategorySection'
import { ItemRow } from './ItemRow'

const byDueDate = (left: Item, right: Item) => left.dueDate.localeCompare(right.dueDate) || left.title.localeCompare(right.title)

/**
 * Entries grouped by category, each group sorted by due date. Each category collapses on its own;
 * which ones are collapsed is remembered per device. Deleted entries waiting to sync are hidden.
 */
export function ItemList({ items, categories }: { items: Item[], categories: Category[] }) {
  const collapsed = collapsedSlugs(useStore($collapsed))
  useEffect(() => {
    // An empty list means the categories haven't loaded yet, not that every category is gone.
    if (categories.length > 0) {
      pruneCollapsed(categories.map(category => category.slug))
    }
  }, [categories])
  const visible = items.filter(item => item.pendingOp !== 'delete')
  const known = new Set(categories.map(category => category.slug))
  // Events put into the calendar by hand, or whose category was removed.
  const other = visible.filter(item => !known.has(item.category)).toSorted(byDueDate)
  return (
    <div className="space-y-6">
      {categories.map(category => (
        <CategorySection
          key={category.slug}
          category={category}
          collapsed={collapsed.includes(category.slug)}
          items={visible.filter(item => item.category === category.slug).toSorted(byDueDate)}
        />
      ))}
      {other.length > 0 && (
        <section aria-label="Uncategorised" className="space-y-1">
          <h2 className="text-lg font-semibold">Uncategorised</h2>
          <ul>{other.map(item => <ItemRow key={item.id} item={item} />)}</ul>
        </section>
      )}
    </div>
  )
}
