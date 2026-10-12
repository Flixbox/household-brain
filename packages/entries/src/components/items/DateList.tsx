import { Link } from 'wouter'
import { newItemPath } from '@household-brain/entries/lib/paths'
import type { Category } from '@household-brain/entries/lib/categories'
import type { Board } from '@household-brain/entries/lib/items/board'
import { ItemRow } from './ItemRow'
import { hasText } from '@household-brain/core/lib/read'

/** What an empty list says: nothing while searching (the board says no entry matches). */
const emptyNote = ({ searching, completed }: Board): string | null => {
  if (searching) {
    return null
  }
  return completed > 0 ? 'No open entries.' : 'No entries yet.'
}

/**
 * "All by date": every listed entry in one list by due date, each labelled with its category. Its
 * header has the "+" the category headers have in the other view, without a category preselected.
 */
export const DateList = ({ board, categories }: { board: Board, categories: Category[] }) => {
  const labelOf = new Map(categories.map(category => [category.slug, category.label]))
  const items = board.flat
  const note = items.length === 0 ? emptyNote(board) : null
  return (
    <section aria-label="All entries by date" className="space-y-1">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-lg font-semibold">All entries</h2>
        <Link href={newItemPath()} aria-label="Add entry" className="text-xl font-semibold text-orange-700 dark:text-orange-400">+</Link>
      </div>
      {hasText(note) && <p className="px-3 text-stone-500">{note}</p>}
      <ul>{items.map(item => <ItemRow key={item.id} item={item} category={labelOf.get(item.category) ?? 'Uncategorised'} />)}</ul>
    </section>
  )
}
