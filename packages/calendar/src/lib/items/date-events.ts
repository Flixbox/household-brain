import { type EntryDate, extraDatesOf } from './dates'
import { type CalendarEvent, DUE_TIME, END_TIME, type EventContext, labelOf, privateProperties, remindersOf, summaryOf } from './event'
import type { Item } from './model'

/**
 * Extra dates get their own Google Calendar events (#34): their ids, the link back to their entry,
 * what they look like, and the plan that brings Google in line with the entry.
 */

/** The `syncState/{uid}.schema` from which an app version recognises date events. */
const DATE_EVENTS_SCHEMA = 2

/** The `syncState/{uid}.schema` from which an app version handles entries without a due date (#33). */
export const UNDATED_SCHEMA = 3

/** Written per person to `syncState/{uid}.schema`: what this app version handles (the newest of the above). */
export const APP_SCHEMA = UNDATED_SCHEMA

/** Whether every person's app that ever synced handles `schema`; one older version is enough to say no. */
export const everyAppHandles = (syncStates: readonly { schema?: unknown }[], schema: number) =>
  syncStates.length > 0 && syncStates.every(state => typeof state.schema === 'number' && state.schema >= schema)

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
 * A deleted one may come without its properties, so then the id alone tells.
 */
export function entryOfEvent(event: CalendarEvent): string | null {
  const properties = event.extendedProperties?.private
  if (!properties && event.status === 'cancelled' && isDateEventId(event.id)) {
    return event.id?.slice(0, 26) ?? null
  }
  const { 'hb.date': dateId, 'hb.entry': entryId } = properties ?? {}
  return isDateEventId(event.id) && entryId && dateId && event.id === dateEventId(entryId, dateId) ? entryId : null
}

/**
 * The full event for one extra date: `[Category] Title · Label` at 17:00 on that date, with the
 * entry's notes and private properties plus the link back (`hb.entry`, `hb.date`, `hb.label`).
 */
export function dateEventFor(item: Item, entryDate: EntryDate, { categories, timeZone }: EventContext): CalendarEvent {
  const label = entryDate.label.trim() || 'Date'
  return {
    colorId: labelOf(item, categories)?.colorId ?? '8',
    description: item.notes,
    end: { dateTime: `${entryDate.date}T${END_TIME}`, timeZone },
    extendedProperties: { private: { ...privateProperties(item), 'hb.date': entryDate.id, 'hb.entry': item.id, 'hb.label': label } },
    id: dateEventId(item.id, entryDate.id),
    reminders: remindersOf(item),
    start: { dateTime: `${entryDate.date}T${DUE_TIME}`, timeZone },
    summary: `${summaryOf(item, categories)} · ${label}`,
  }
}

/** An event as written, as text: what the ledger keeps and compares. */
export const shapeOf = (event: CalendarEvent) => JSON.stringify(event)

/**
 * The extra dates that can have an event: their id must be one every app recognises. An entry that
 * came from Google keeps that event's id, which can be longer than the app's own; its extra dates
 * stay in the app.
 */
const writableDatesOf = (item: Item) => extraDatesOf(item).filter(entryDate => isDateEventId(dateEventId(item.id, entryDate.id)))

/** One write to Google for an extra date's event. */
export type DateOp =
  | { kind: 'upsert', dateId: string, event: CalendarEvent, shape: string }
  | { kind: 'delete', dateId: string }

/**
 * What Google needs so that its date events match the entry: an upsert for every extra date whose
 * event isn't in that shape yet (new, moved, relabelled, or a shared field changed), and a delete for
 * every event whose date is gone. Pure: the ledger (`dateEvents`) says what Google holds.
 */
export function planDates(item: Item, context: EventContext): DateOp[] {
  const ledger = item.dateEvents ?? {}
  const dates = writableDatesOf(item)
  const upserts = dates.flatMap((entryDate): DateOp[] => {
    const event = dateEventFor(item, entryDate, context)
    const shape = shapeOf(event)
    return ledger[entryDate.id]?.shape === shape ? [] : [{ dateId: entryDate.id, event, kind: 'upsert', shape }]
  })
  const kept = new Set(dates.map(entryDate => entryDate.id))
  const deletes = Object.keys(ledger).filter(dateId => !kept.has(dateId)).map((dateId): DateOp => ({ dateId, kind: 'delete' }))
  return [...upserts, ...deletes]
}

/** Every date event an entry may have in Google: recorded ones, and ones whose insert may have landed unrecorded. */
export const dateEventIdsOf = (item: Item) =>
  [...new Set([...Object.keys(item.dateEvents ?? {}), ...writableDatesOf(item).map(entryDate => entryDate.id)])].map(dateId => dateEventId(item.id, dateId))

/**
 * Whether date events may be written: every person whose app has ever synced (`syncState/{uid}`, which
 * every app version writes) runs a version that recognises them. One person on an older version closes it.
 */
export const dateEventsAllowed = (syncStates: readonly { schema?: unknown }[]) => everyAppHandles(syncStates, DATE_EVENTS_SCHEMA)

/**
 * Whether a date event in Google has nothing left in the app to belong to, so it should go: its entry
 * is gone (deleted in Google, or by an app version from before date events), or the entry no longer
 * has that date and doesn't know the event either (an insert that landed unrecorded). Not while the
 * entry's own deletion or the date's planned delete is still to be pushed: those remove it anyway.
 */
export function isOrphanDate(entry: Item | null, dateId: string): boolean {
  if (!entry) {
    return true
  }
  const known = entry.pendingOp === 'delete' || dateId in (entry.dateEvents ?? {}) || extraDatesOf(entry).some(entryDate => entryDate.id === dateId)
  return !known
}
