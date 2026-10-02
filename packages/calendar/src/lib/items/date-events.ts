import type { CalendarEvent } from './event'

/**
 * Extra dates get their own Google Calendar events (#34). This module holds what every app version
 * must recognise before any such event is written: their ids and the link back to their entry.
 */

/** Written per person to `syncState/{uid}.schema`: this app version recognises date events. */
export const DATE_EVENTS_SCHEMA = 2

/** The id of the event for an entry's extra date; never a valid entry id (those are 26 characters). */
export const dateEventId = (entryId: string, dateId: string) => `${entryId}d${dateId}`

/**
 * Whether an id has the shape of an extra date's event: an entry id (26), "d", a date id (8). An
 * entry's own event never does, so it can't be mistaken for one; a deleted event, which a listing
 * may send without its properties, is still recognised.
 */
export const isDateEventId = (id: string | undefined) => /^[0-9a-v]{26}d[0-9a-v]{8}$/u.test(id ?? '')

/**
 * The entry an event belongs to when it is one of its extra dates' events: its id has that shape
 * and matches its link (`hb.entry`, `hb.date`). Null for anything else, an entry's own event included.
 */
export function entryOfEvent(event: CalendarEvent): string | null {
  const { 'hb.date': dateId, 'hb.entry': entryId } = event.extendedProperties?.private ?? {}
  return isDateEventId(event.id) && entryId && dateId && event.id === dateEventId(entryId, dateId) ? entryId : null
}
