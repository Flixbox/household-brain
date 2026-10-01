import type { Category } from '../categories'
import { type CalendarApi, CalendarApiError } from '../calendar/api'
import type { HouseholdConfig } from '../calendar/setup'
import { eventFor, patchFor } from './event'
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
  | { kind: 'synced', etag: string }
  | { kind: 'deleted' }

const isStatus = (error: unknown, status: number) => error instanceof CalendarApiError && error.status === status
const eventContext = ({ config, categories }: PushContext) => ({ categories, timeZone: config.timeZone })

async function insert(context: PushContext, item: Item): Promise<string> {
  const { api, config } = context
  try {
    return (await api.insertEvent(config.calendarId, eventFor(item, eventContext(context)))).etag ?? ''
  } catch (error) {
    // 409: an earlier attempt already created it (the id is ours), so the insert did succeed.
    if (!isStatus(error, 409)) {
      throw error
    }
    return (await api.getEvent(config.calendarId, item.id)).etag ?? ''
  }
}

async function patch(context: PushContext, item: Item, etag: string): Promise<string> {
  const { api, config } = context
  const target = { calendarId: config.calendarId, eventId: item.id }
  const changes = patchFor(item, item.dirty, eventContext(context))
  try {
    return (await api.patchEvent(target, changes, etag)).etag ?? ''
  } catch (error) {
    // 412: the event changed in Google since we last saw it. The fields changed here win; retry once
    // Against the current version. (Merging Google's other changes into the entry comes with the pull.)
    if (!isStatus(error, 412)) {
      throw error
    }
    const current = await api.getEvent(config.calendarId, item.id)
    return (await api.patchEvent(target, changes, current.etag ?? '')).etag ?? ''
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
    return { etag: await patch(context, item, etag), kind: 'synced' }
  }
  // Nothing seen yet as this user: a new entry, or one only the other person has pushed so far. An
  // Insert covers both: it creates the event, or gets 409 and reads the current one.
  const inserted = await insert(context, item)
  const editsOthersEvent = Object.keys(item.etags).length > 0 && item.dirty.length > 0
  return { etag: editsOthersEvent ? await patch(context, item, inserted) : inserted, kind: 'synced' }
}
