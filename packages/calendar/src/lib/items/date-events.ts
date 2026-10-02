import type { CalendarEvent } from './event'

/**
 * Extra dates get their own Google Calendar events (#34). This module holds what every app version
 * must recognise before any such event is written: their ids and the link back to their entry.
 */

/** Written per person to `syncState/{uid}.schema`: this app version recognises date events. */
export const DATE_EVENTS_SCHEMA = 2

/** The id of the event for an entry's extra date; never a valid entry id (those are 26 characters). */
export const dateEventId = (entryId: string, dateId: string) => `${entryId}d${dateId}`

/** The entry an event belongs to when it is one of its extra dates' events; null for an entry's own event. */
export function entryOfEvent(event: CalendarEvent): string | null {
  return event.extendedProperties?.private?.['hb.entry'] || null
}
