import { extraDatesOf } from './dates'
import { dateEventFor, planDates } from './date-events'
import { type CalendarEvent, DUE_TIME, END_TIME, type EventContext } from './event'
import { dueDateOf, isAt } from './from-event'
import type { Item } from './model'

/** What a date event changed in Google means for its entry. */
export type DateEventChange =
  | { kind: 'none' }
  /** Moved in Google: the entry takes the new date. */
  | { kind: 'adopt', date: string }
  /** Deleted in Google: the entry drops the date. */
  | { kind: 'remove' }
  /** Edited otherwise (title, notes, time, reminders): written back as the app has it. */
  | { kind: 'rewrite' }

const NONE: DateEventChange = { kind: 'none' }

/** Whether a date event is exactly what the app writes, apart from its date. */
function fits(event: CalendarEvent, expected: CalendarEvent, timeZone: string): boolean {
  const theirs = event.extendedProperties?.private ?? {}
  return isAt(event.start, DUE_TIME, timeZone) && isAt(event.end, END_TIME, timeZone)
    && event.reminders?.useDefault === true && !event.reminders.overrides?.length
    && event.summary === expected.summary && (event.description ?? '') === (expected.description ?? '')
    && event.colorId === expected.colorId
    && Object.entries(expected.extendedProperties?.private ?? {}).every(([key, value]) => (theirs[key] ?? '') === value)
}

/**
 * Decides what a date event as Google has it means for its entry. Only the date and the deletion are
 * taken over; the entry stays the source of everything else, so other edits are put back. Nothing is
 * taken over while the app still has a change of its own to write to that event: that change wins.
 */
export function dateEventChange({ item, dateId, event }: { item: Item, dateId: string, event: CalendarEvent }, context: EventContext): DateEventChange {
  const entryDate = extraDatesOf(item).find(candidate => candidate.id === dateId)
  // An entry on its way out takes no changes: its own push deletes the date events.
  if (!entryDate || item.pendingOp === 'delete' || planDates(item, context).some(op => op.dateId === dateId)) {
    return NONE
  }
  if (event.status === 'cancelled') {
    return { kind: 'remove' }
  }
  const date = dueDateOf(event)
  if (/^\d{4}-\d{2}-\d{2}$/u.test(date) && date !== entryDate.date) {
    return { date, kind: 'adopt' }
  }
  return fits(event, dateEventFor(item, entryDate, context), context.timeZone) ? NONE : { kind: 'rewrite' }
}
