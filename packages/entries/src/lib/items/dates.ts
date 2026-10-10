import type { Item } from './model'

/** A date an entry has besides its due date ("Cancel by", "Valid from", …). */
export interface EntryDate {
  /** Stable within the entry, so an edit of one date can't be mistaken for another. */
  id: string
  label: string
  /** `YYYY-MM-DD`. */
  date: string
}

/** Labels offered for an extra date; any other text is fine too. */
export const DATE_LABELS = ['Cancel by', 'Renews', 'Valid from', 'Expires', 'Check'] as const

/** Whether a stored value is a `YYYY-MM-DD` date (an entry's due date may be empty: a balance). */
export const isDate = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/u.test(value)

/** The extra dates that are usable (a stored value can come from an older or newer app version). */
export const extraDatesOf = (item: Pick<Item, 'extraDates'>): EntryDate[] =>
  (item.extraDates ?? []).filter(entry => isDate(entry.date))

/** All of an entry's dates, its due date first among equals, in date order. None for a balance with no dates. */
export const datesOf = (item: Pick<Item, 'dueDate' | 'extraDates'>): EntryDate[] => {
  const due: EntryDate[] = isDate(item.dueDate) ? [{ date: item.dueDate, id: 'due', label: 'Due' }] : []
  return [...due, ...extraDatesOf(item)].toSorted((left, right) => left.date.localeCompare(right.date))
}

/**
 * The date that matters now. A passed due date wins (the entry is overdue, whatever comes later);
 * otherwise the first date from `today` on, or the last one once all have passed. Null for an entry
 * with no dates at all (a balance that never expires).
 */
export const nextDate = (item: Pick<Item, 'dueDate' | 'extraDates'>, today: string): EntryDate | null => {
  if (isDate(item.dueDate) && item.dueDate < today) {
    return { date: item.dueDate, id: 'due', label: 'Due' }
  }
  const dates = datesOf(item)
  return dates.find(entry => entry.date >= today) ?? dates.at(-1) ?? null
}

/** Whether two lists of extra dates say the same. */
export const sameDates = (left: readonly EntryDate[] = [], right: readonly EntryDate[] = []) =>
  JSON.stringify(left) === JSON.stringify(right)
