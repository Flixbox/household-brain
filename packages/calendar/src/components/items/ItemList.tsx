import { useStore } from '@nanostores/react'
import type { Category } from '../../lib/categories'
import type { Item } from '../../lib/items/model'
import { boardFor } from '../../lib/items/board'
import { $byDate } from '../../lib/items/by-date'
import { $search } from '../../lib/items/search'
import { $showCompleted } from '../../lib/items/show-completed'
import { BoardToggles } from './BoardToggles'
import { CategoryList } from './CategoryList'
import { DateList } from './DateList'
import { SearchBox } from './SearchBox'

/**
 * The board: a search field, the "All by date" and "Show completed" toggles, and the entries
 * (`boardFor`), by category or, with "All by date", in one list by due date.
 */
export function ItemList({ items, categories }: { items: Item[], categories: Category[] }) {
  const query = useStore($search)
  const board = boardFor({ categories, items, query, showCompleted: useStore($showCompleted) })
  const byDate = useStore($byDate)
  return (
    <div className="space-y-6">
      <SearchBox />
      {board.searching && board.empty && <p className="text-stone-500">No entries match “{query.trim()}”.</p>}
      <BoardToggles completed={board.completed} searching={board.searching} />
      {byDate ? <DateList board={board} categories={categories} /> : <CategoryList board={board} />}
    </div>
  )
}
