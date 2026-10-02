import { CalendarApiError } from '../calendar/api'
import { type DateOp, dateEventId, dateEventIdsOf } from './date-events'
import type { CalendarEvent } from './event'
import type { Item } from './model'
import type { PushContext } from './push'

const isStatus = (error: unknown, status: number) => error instanceof CalendarApiError && error.status === status

/**
 * Writes a date event in full. The app is its only source (edits made to it in Google are put back),
 * so there is no merge: an insert, or on 409 (it exists, maybe deleted in Google) a full patch
 * against the etag just read, which also brings a deleted one back.
 */
async function upsert({ api, config }: PushContext, event: CalendarEvent): Promise<void> {
  try {
    await api.insertEvent(config.calendarId, event)
  } catch (error) {
    if (!isStatus(error, 409)) {
      throw error
    }
    const eventId = event.id ?? ''
    const { etag = '' } = await api.getEvent(config.calendarId, eventId)
    const { id: _id, ...full } = event
    await api.patchEvent({ calendarId: config.calendarId, eventId }, { ...full, status: 'confirmed' }, etag)
  }
}

/** Carries out one planned write; deleting a missing event is harmless. */
export function pushDateOp(context: PushContext, item: Item, op: DateOp): Promise<void> {
  return op.kind === 'upsert'
    ? upsert(context, op.event)
    : context.api.deleteEvent(context.config.calendarId, dateEventId(item.id, op.dateId))
}

/** Deletes every date event an entry may have in Google, before the entry's own event goes. */
export async function deleteDateEvents({ api, config }: PushContext, item: Item): Promise<void> {
  await Promise.all(dateEventIdsOf(item).map(eventId => api.deleteEvent(config.calendarId, eventId)))
}
