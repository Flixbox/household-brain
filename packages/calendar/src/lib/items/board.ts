import type { Category } from '@household-brain/calendar/lib/categories'
import type { Item } from './model'
import { matchesSearch } from './search'
import { nextDate } from './dates'

/** An entry's sort key: its next date, or one after every date for an entry with none (a balance). */
const sortDate = (item: Item, today: string) => nextDate(item, today)?.date ?? '9999-99-99'

/** By each entry's next date (its due date, or an extra date coming first), then by title; undated last. */
const byNextDate = (today: string) => (left: Item, right: Item) =>
  sortDate(left, today).localeCompare(sortDate(right, today)) || left.title.localeCompare(right.title)

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
export const boardFor = ({ items, categories, query, showCompleted, today }: { items: readonly Item[], categories: readonly Category[], query: string, showCompleted: boolean, today: string }): Board => {
  const byDate = byNextDate(today)
  const searching = query.trim() !== ''
  const current = items.filter(item => item.pendingOp !== 'delete')
  const listed = current.filter(item => (searching ? matchesSearch(item, query) : showCompleted || item.status === 'open'))
  const known = new Set(categories.map(category => category.slug))
  const sections = categories
    .map(category => ({ category, items: listed.filter(item => item.category === category.slug).toSorted(byDate) }))
    .filter(section => !searching || section.items.length > 0)
  return {
    completed: current.filter(item => item.status !== 'open').length,
    empty: listed.length === 0,
    flat: listed.toSorted(byDate),
    other: listed.filter(item => !known.has(item.category)).toSorted(byDate),
    searching,
    sections,
  }
}
