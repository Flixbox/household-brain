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

function ahead(count: number): string {
  if (count === 0) {
    return 'today, 17:00'
  }
  return count === 1 ? 'tomorrow, 17:00' : `in ${days(count)}`
}

/** How urgent an entry due on `dueDate` (YYYY-MM-DD) at 17:00 is at `now`, and how to say when. */
export function dueStatus(dueDate: string, now: Temporal.ZonedDateTime): Due {
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
