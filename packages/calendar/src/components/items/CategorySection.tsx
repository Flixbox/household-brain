import { Link } from '@tanstack/react-router'
import type { Category } from '../../lib/categories'
import type { Item } from '../../lib/items/model'
import { toggleCollapsed } from '../../lib/items/collapsed'
import { ItemRow } from './ItemRow'

/** One category: a header that collapses it (with the open count), its "+", and its entries. */
export function CategorySection({ category, items, collapsed }: { category: Category, items: Item[], collapsed: boolean }) {
  const listId = `category-${category.slug}`
  const open = items.filter(item => item.status === 'open').length
  return (
    <section aria-label={category.label} className="space-y-1">
      <div className="flex items-baseline justify-between gap-3">
        <button
          type="button"
          aria-expanded={!collapsed}
          aria-controls={listId}
          onClick={() => toggleCollapsed(category.slug)}
          className="flex flex-1 items-baseline gap-2 text-left"
        >
          <span aria-hidden="true" className={`inline-block text-sm text-stone-500 transition-transform ${collapsed ? '-rotate-90' : ''}`}>▾</span>
          <h2 className="text-lg font-semibold">{category.label}</h2>
          {open > 0 && <span className="text-sm text-stone-500 tabular-nums">{open} open</span>}
        </button>
        <Link to="/items/new" search={{ category: category.slug }} aria-label={`Add ${category.label}`} className="text-xl font-semibold text-orange-700 dark:text-orange-400">+</Link>
      </div>
      <ul id={listId} hidden={collapsed}>
        {items.map(item => <ItemRow key={item.id} item={item} />)}
      </ul>
    </section>
  )
}
