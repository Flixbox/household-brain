import { useStore } from '@nanostores/react'
import type { Category } from '../../lib/categories'
import type { Item } from '../../lib/items/model'
import { boardFor } from '../../lib/items/board'
import { $collapsed, collapsedSlugs } from '../../lib/items/collapsed'
import { $search } from '../../lib/items/search'
import { $showCompleted } from '../../lib/items/show-completed'
import { CategorySection } from './CategorySection'
import { CompletedToggle } from './CompletedToggle'
import { ItemRow } from './ItemRow'
import { SearchBox } from './SearchBox'

/**
 * The board: a search field, "Show completed", and the entries grouped by category (`boardFor`).
 * Each category collapses on its own, remembered per device; while searching, every category with
 * a match is open, or the match would stay hidden.
 */
export function ItemList({ items, categories }: { items: Item[], categories: Category[] }) {
  const collapsed = collapsedSlugs(useStore($collapsed))
  const query = useStore($search)
  const board = boardFor({ categories, items, query, showCompleted: useStore($showCompleted) })
  return (
    <div className="space-y-6">
      <SearchBox />
      {board.searching && board.empty && <p className="text-stone-500">No entries match “{query.trim()}”.</p>}
      {!board.searching && <CompletedToggle completed={board.completed} />}
      {board.sections.map(section => (
        <CategorySection
          key={section.category.slug}
          category={section.category}
          collapsed={!board.searching && collapsed.includes(section.category.slug)}
          foldable={!board.searching}
          items={section.items}
        />
      ))}
      {board.other.length > 0 && (
        <section aria-label="Uncategorised" className="space-y-1">
          <h2 className="text-lg font-semibold">Uncategorised</h2>
          <ul>{board.other.map(item => <ItemRow key={item.id} item={item} />)}</ul>
        </section>
      )}
    </div>
  )
}
