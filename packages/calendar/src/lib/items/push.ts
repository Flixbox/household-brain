import type { Category } from '../categories'
import { type CalendarApi, CalendarApiError, type EventTarget } from '../calendar/api'
import type { HouseholdConfig } from '../calendar/setup'
import { deleteDateEvents } from './date-push'
import { type CalendarEvent, eventFor, patchFor } from './event'
import { isDate } from './dates'
import type { Item } from './model'

/** Everything a push needs besides the entry. */
export interface PushContext {
  api: CalendarApi
  config: HouseholdConfig
  /** The signed-in user; etags are tracked per user. */
  uid: string
  categories: readonly Category[]
}

/** What the push did, for the store to record. */
export type PushOutcome =
  /** `event`: Google's full event after the write, which may include changes made in Google meanwhile. */
  | { kind: 'synced', event: CalendarEvent }
  | { kind: 'deleted' }
  /** An entry without a due date (a balance): it has no event, and one it had was deleted. */
  | { kind: 'unscheduled' }

const isStatus = (error: unknown, status: number) => error instanceof CalendarApiError && error.status === status
const eventContext = ({ config, categories }: PushContext) => ({ categories, timeZone: config.timeZone })

/** The event after an insert; `existed` when Google already had it (409). */
interface Inserted {
  event: CalendarEvent
  existed: boolean
}

async function insert(context: PushContext, item: Item): Promise<Inserted> {
  const { api, config } = context
  try {
    return { event: await api.insertEvent(config.calendarId, eventFor(item, eventContext(context))), existed: false }
  } catch (error) {
    // 409: an earlier attempt already created it (the id is ours), so the insert did succeed. If it
    // was deleted in Google since, the entry still exists here: bring it back.
    if (!isStatus(error, 409)) {
      throw error
    }
    const existing = await api.getEvent(config.calendarId, item.id)
    const event = existing.status === 'cancelled'
      ? await restore(context, item, { calendarId: config.calendarId, eventId: item.id })
      : existing
    return { event, existed: true }
  }
}

async function restore(context: PushContext, item: Item, target: EventTarget): Promise<CalendarEvent> {
  // The event was deleted in Google while the entry still exists here: write it back in full. A
  // deleted event keeps its id, so the insert answers 409 and the event is revived with a patch.
  const { api, config } = context
  const { id: _id, ...full } = eventFor(item, eventContext(context))
  try {
    return await api.insertEvent(config.calendarId, { ...full, id: item.id })
  } catch (error) {
    if (!isStatus(error, 409)) {
      throw error
    }
    const { etag = '' } = await api.getEvent(config.calendarId, item.id)
    return api.patchEvent(target, { ...full, status: 'confirmed' }, etag)
  }
}

interface Attempt {
  item: Item
  target: EventTarget
  changes: CalendarEvent
}

/** After a failed patch: revive a deleted event, or retry once on a conflict (the local edit wins). */
async function recover(context: PushContext, { item, target, changes }: Attempt, error: unknown): Promise<CalendarEvent> {
  if (isStatus(error, 404) || isStatus(error, 410)) {
    return restore(context, item, target)
  }
  // 412: the event changed in Google since we last saw it. Merging Google's other changes into the
  // entry comes with the pull; until then the fields changed here simply win.
  if (!isStatus(error, 412)) {
    throw error
  }
  const current = await context.api.getEvent(target.calendarId, item.id)
  // Deleted in Google while edited here: the local edit wins and brings the whole event back.
  if (current.status === 'cancelled') {
    return restore(context, item, target)
  }
  return context.api.patchEvent(target, changes, current.etag ?? '')
}

async function patch(context: PushContext, item: Item, etag: string): Promise<CalendarEvent> {
  const target = { calendarId: context.config.calendarId, eventId: item.id }
  const changes = patchFor(item, item.dirty, eventContext(context))
  try {
    return await context.api.patchEvent(target, changes, etag)
  } catch (error) {
    return recover(context, { changes, item, target }, error)
  }
}

/**
 * An entry without a due date has no event. When it had one (its date was just removed, or someone
 * pushed it before), that event is deleted; a missing one is fine. Its extra dates' events stay.
 */
async function unschedule(context: PushContext, item: Item): Promise<PushOutcome> {
  if (Object.keys(item.etags).length > 0 || item.dirty.includes('dueDate')) {
    await context.api.deleteEvent(context.config.calendarId, item.id)
  }
  return { kind: 'unscheduled' }
}

/** A deleted entry: its date events go first, then its own event. */
async function remove(context: PushContext, item: Item): Promise<PushOutcome> {
  await deleteDateEvents(context, item)
  await context.api.deleteEvent(context.config.calendarId, item.id)
  return { kind: 'deleted' }
}

/** Pushes one pending entry to Google Calendar. */
export async function pushItem(context: PushContext, item: Item): Promise<PushOutcome> {
  if (item.pendingOp === 'delete') {
    return remove(context, item)
  }
  if (!isDate(item.dueDate)) {
    return unschedule(context, item)
  }
  const etag = item.etags[context.uid]
  if (etag) {
    return { event: await patch(context, item, etag), kind: 'synced' }
  }
  // No etag for this person yet: a new entry, one only the other person has pushed, or one created by
  // a pull whose etag was never recorded. An insert covers all: it creates the event, or gets 409 and
  // reads the existing one, which the local edits are then patched onto.
  const { event, existed } = await insert(context, item)
  return { event: existed && item.dirty.length > 0 ? await patch(context, item, event.etag ?? '') : event, kind: 'synced' }
}
