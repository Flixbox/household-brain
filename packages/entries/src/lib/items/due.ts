import { Temporal } from 'temporal-polyfill'

/** Every entry is due at this time of day, in the household's time zone. */
const DUE_TIME = Temporal.PlainTime.from('17:00')
/** Due within this many days (and not overdue yet) counts as soon. */
const SOON_DAYS = 7

export type Urgency = 'overdue' | 'soon' | 'later'

export interface Due {
  urgency: Urgency
  /** Relative to now: "tomorrow, 17:00", "in 5 days", "overdue by 2 days". */
  label: string
}

const days = (count: number) => (count === 1 ? '1 day' : `${count} days`)

const ahead = (count: number): string => {
  if (count === 0) {
    return 'today, 17:00'
  }
  return count === 1 ? 'tomorrow, 17:00' : `in ${days(count)}`
}

/** How urgent an entry due on `dueDate` (YYYY-MM-DD) at 17:00 is at `now`, and how to say when. */
export const dueStatus = (dueDate: string, now: Temporal.ZonedDateTime): Due => {
  const date = Temporal.PlainDate.from(dueDate)
  const deadline = date.toZonedDateTime({ plainTime: DUE_TIME, timeZone: now.timeZoneId })
  const today = now.toPlainDate()
  // Whole calendar days from today to the due date: negative once it lies in the past.
  const daysAhead = today.until(date, { largestUnit: 'day' }).days
  if (Temporal.ZonedDateTime.compare(now, deadline) >= 0) {
    return { label: daysAhead === 0 ? 'overdue since 17:00 today' : `overdue by ${days(-daysAhead)}`, urgency: 'overdue' }
  }
  return { label: ahead(daysAhead), urgency: daysAhead <= SOON_DAYS ? 'soon' : 'later' }
}

/**
 * What an entry's row says about when it is due: for an open entry its `dueStatus`, for a done or
 * cancelled one just that, uncoloured (being past its date doesn't make it overdue).
 */
export const rowDue = (item: { dueDate: string, status: 'open' | 'done' | 'cancelled' }, now: Temporal.ZonedDateTime): Due =>
  item.status === 'open' ? dueStatus(item.dueDate, now) : { label: item.status, urgency: 'later' }

/**
 * When an entry started, for its row: "since …" once the start date has come, "from …" while it
 * is still ahead (a coupon not valid yet); null without one.
 */
export const startLabel = (startDate: string | null | undefined, now: Temporal.ZonedDateTime): string | null => {
  if (!startDate) {
    return null
  }
  try {
    const notYet = Temporal.PlainDate.compare(Temporal.PlainDate.from(startDate), now.toPlainDate()) > 0
    return `${notYet ? 'from' : 'since'} ${startDate}`
  } catch {
    // Not a date (written by something else): show nothing rather than break the board.
    return null
  }
}
