import { useStore } from '@nanostores/react'
import type { Category } from '../../lib/categories'
import type { Item } from '../../lib/items/model'
import { $collapsed, collapsedSlugs } from '../../lib/items/collapsed'
import { $showCompleted, toggleShowCompleted } from '../../lib/items/show-completed'
import { CategorySection } from './CategorySection'
import { ItemRow } from './ItemRow'

const byDueDate = (left: Item, right: Item) => left.dueDate.localeCompare(right.dueDate) || left.title.localeCompare(right.title)

/**
 * Entries grouped by category, each group sorted by due date. Each category collapses on its own;
 * which ones are collapsed is remembered per device. Done and cancelled entries show only after
 * "Show completed" (also per device). Deleted entries waiting to sync are hidden.
 */
export function ItemList({ items, categories }: { items: Item[], categories: Category[] }) {
  const collapsed = collapsedSlugs(useStore($collapsed))
  const showCompleted = useStore($showCompleted)
  const current = items.filter(item => item.pendingOp !== 'delete')
  const completed = current.filter(item => item.status !== 'open').length
  const visible = showCompleted ? current : current.filter(item => item.status === 'open')
  const known = new Set(categories.map(category => category.slug))
  // Events put into the calendar by hand, or whose category was removed.
  const other = visible.filter(item => !known.has(item.category)).toSorted(byDueDate)
  return (
    <div className="space-y-6">
      {/* Stays while it is on, so it can be switched off even once nothing is completed. */}
      {(completed > 0 || showCompleted) && (
        // A toggle keeps one name; whether it is on is aria-pressed (and the filled look).
        <button
          type="button"
          aria-pressed={showCompleted}
          onClick={toggleShowCompleted}
          className="rounded-full border border-stone-300 px-3 py-1 text-sm font-medium aria-pressed:border-orange-600 aria-pressed:bg-orange-600 aria-pressed:text-white dark:border-stone-700"
        >
          {`Show completed (${completed})`}
        </button>
      )}
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
