import { useStore } from '@nanostores/react'
import type { Board } from '@household-brain/calendar/lib/items/board'
import { $collapsed, collapsedSlugs } from '@household-brain/calendar/lib/items/collapsed'
import { CategorySection } from './CategorySection'
import { NO_CATEGORY_COLOR } from '@household-brain/calendar/lib/category-colors'
import { ItemRow } from './ItemRow'

/**
 * The entries by category. Each category collapses on its own, remembered per device; while
 * searching, every category with a match is open, or the match would stay hidden.
 */
export const CategoryList = ({ board }: { board: Board }) => {
  const collapsed = collapsedSlugs(useStore($collapsed))
  return (
    <>
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
        <section aria-label="Uncategorised" className="space-y-1 border-l-4 pl-3" style={{ borderColor: NO_CATEGORY_COLOR }}>
          <h2 className="text-lg font-semibold">Uncategorised</h2>
          <ul>{board.other.map(item => <ItemRow key={item.id} item={item} />)}</ul>
        </section>
      )}
    </>
  )
}
