import type { Temporal } from 'temporal-polyfill'
import type { Item } from '@household-brain/calendar/lib/items/model'
import { type Urgency, rowDue } from '@household-brain/calendar/lib/items/due'
import type { EntryDate } from '@household-brain/calendar/lib/items/dates'

const URGENCY_TEXT: Record<Urgency, string> = {
  later: 'text-stone-500',
  overdue: 'font-semibold text-red-700 dark:text-red-400',
  soon: 'font-semibold text-amber-700 dark:text-amber-400',
}

interface Props {
  item: Item
  /** The date that matters now, or null for an entry with no dates (a balance). */
  next: EntryDate | null
  /** " + more" when the entry has other dates. */
  more: string
  since: string | null
  now: Temporal.ZonedDateTime
}

/**
 * A row's right-hand column: when it is due (relative, coloured by urgency, and the date). An entry
 * with no dates, such as a gift card credit that never expires, says "no expiry"; its price stays
 * under the title like every other entry's (#87).
 */
export const DueColumn = ({ item, next, more, since, now }: Props) => {
  if (!next) {
    return (
      <span className="flex flex-col items-end text-sm">
        <span className="text-xs text-stone-500">{item.status === 'open' ? 'no expiry' : item.status}</span>
      </span>
    )
  }
  const due = rowDue({ dueDate: next.date, status: item.status }, now)
  return (
    <span className="flex flex-col items-end text-sm">
      <span className={URGENCY_TEXT[due.urgency]}>{due.label}{more}</span>
      <span className="text-xs text-stone-500 tabular-nums">{next.date}{more}</span>
      {since && <span className="text-xs text-stone-500 tabular-nums">{since}</span>}
    </span>
  )
}
