import type { Category } from '../categories'
import { type CalendarApi, CalendarApiError, type EventTarget } from '../calendar/api'
import type { HouseholdConfig } from '../calendar/setup'
import { type CalendarEvent, eventFor, patchFor } from './event'
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

const isStatus = (error: unknown, status: number) => error instanceof CalendarApiError && error.status === status
const eventContext = ({ config, categories }: PushContext) => ({ categories, timeZone: config.timeZone })

async function insert(context: PushContext, item: Item): Promise<CalendarEvent> {
  const { api, config } = context
  try {
    return await api.insertEvent(config.calendarId, eventFor(item, eventContext(context)))
  } catch (error) {
    // 409: an earlier attempt already created it (the id is ours), so the insert did succeed.
    if (!isStatus(error, 409)) {
      throw error
    }
    return api.getEvent(config.calendarId, item.id)
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
  const { etag = '' } = await context.api.getEvent(target.calendarId, item.id)
  return context.api.patchEvent(target, changes, etag)
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

/** Pushes one pending entry to Google Calendar. */
export async function pushItem(context: PushContext, item: Item): Promise<PushOutcome> {
  if (item.pendingOp === 'delete') {
    await context.api.deleteEvent(context.config.calendarId, item.id)
    return { kind: 'deleted' }
  }
  const etag = item.etags[context.uid]
  if (etag) {
    return { event: await patch(context, item, etag), kind: 'synced' }
  }
  // Nothing seen yet as this user: a new entry, or one only the other person has pushed so far. An
  // insert covers both: it creates the event, or gets 409 and reads the current one.
  const inserted = await insert(context, item)
  const editsOthersEvent = Object.keys(item.etags).length > 0 && item.dirty.length > 0
  return { event: editsOthersEvent ? await patch(context, item, inserted.etag ?? '') : inserted, kind: 'synced' }
}
