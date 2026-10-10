import { Link } from '@tanstack/react-router'
import type { Category } from '@household-brain/entries/lib/categories'
import type { Item } from '@household-brain/entries/lib/items/model'
import { toggleCollapsed } from '@household-brain/entries/lib/items/collapsed'
import { categoryColor } from '@household-brain/entries/lib/category-colors'
import { ItemRow } from './ItemRow'

/**
 * One category: a header that collapses it (with the open count), its "+", and its entries.
 * `foldable` is false while searching: the section is shown open and its header is plain text, so
 * a tap can't change the remembered folding unseen.
 */
export const CategorySection = ({ category, items, collapsed, foldable = true }: { category: Category, items: Item[], collapsed: boolean, foldable?: boolean }) => {
  const listId = `category-${category.slug}`
  const open = items.filter(item => item.status === 'open').length
  return (
    // A line down the left in the category's Google Calendar colour, from its heading to its last entry.
    <section aria-label={category.label} className="space-y-1 border-l-4 pl-3" style={{ borderColor: categoryColor(category.colorId) }}>
      <div className="flex items-baseline justify-between gap-3">
        {/* The button sits inside the heading, so the category stays a heading for screen readers. */}
        <h2 className="flex-1 text-lg font-semibold">
          {foldable
            ? (
              <button
                type="button"
                aria-expanded={!collapsed}
                aria-controls={listId}
                onClick={() => toggleCollapsed(category.slug)}
                className="flex w-full items-baseline gap-2 text-left"
              >
                <span aria-hidden="true" className={`inline-block text-sm text-stone-500 transition-transform ${collapsed ? '-rotate-90' : ''}`}>▾</span>
                <span>{category.label}</span>
                {open > 0 && <span className="text-sm font-normal text-stone-500 tabular-nums">{open} open</span>}
              </button>
            )
            : (
              <span className="flex items-baseline gap-2">
                <span>{category.label}</span>
                {open > 0 && <span className="text-sm font-normal text-stone-500 tabular-nums">{open} open</span>}
              </span>
            )}
        </h2>
        <Link to="/items/new" search={{ category: category.slug }} aria-label={`Add ${category.label}`} className="text-xl font-semibold text-orange-700 dark:text-orange-400">+</Link>
      </div>
      <ul id={listId} hidden={collapsed}>
        {items.map(item => <ItemRow key={item.id} item={item} />)}
      </ul>
    </section>
  )
}
