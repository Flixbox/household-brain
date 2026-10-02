import type { Category } from '../categories'
import type { Item } from './model'
import { matchesSearch } from './search'

const byDueDate = (left: Item, right: Item) => left.dueDate.localeCompare(right.dueDate) || left.title.localeCompare(right.title)

export interface Board {
  searching: boolean
  /** Done and cancelled entries, for "Show completed (n)". */
  completed: number
  /** Whether any entry is listed at all. */
  empty: boolean
  /** The categories to list, each with its entries sorted by due date. */
  sections: { category: Category, items: Item[] }[]
  /** Entries in no known category: events put in by hand, or whose category was removed. */
  other: Item[]
  /** Every listed entry in one list, sorted by due date ("All by date"). */
  flat: Item[]
}

/**
 * What the board lists. Deleted entries waiting to sync never show. Without a search, done and
 * cancelled entries show only with `showCompleted`. A search shows every matching entry, completed
 * ones included, and only the categories that have a match.
 */
export function boardFor({ items, categories, query, showCompleted }: { items: readonly Item[], categories: readonly Category[], query: string, showCompleted: boolean }): Board {
  const searching = query.trim() !== ''
  const current = items.filter(item => item.pendingOp !== 'delete')
  const listed = current.filter(item => (searching ? matchesSearch(item, query) : showCompleted || item.status === 'open'))
  const known = new Set(categories.map(category => category.slug))
  const sections = categories
    .map(category => ({ category, items: listed.filter(item => item.category === category.slug).toSorted(byDueDate) }))
    .filter(section => !searching || section.items.length > 0)
  return {
    completed: current.filter(item => item.status !== 'open').length,
    empty: listed.length === 0,
    flat: listed.toSorted(byDueDate),
    other: listed.filter(item => !known.has(item.category)).toSorted(byDueDate),
    searching,
    sections,
  }
}
