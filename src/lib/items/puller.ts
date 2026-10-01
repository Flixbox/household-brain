import { CalendarApiError, type EventCursor, type EventPage } from '../calendar/api'
import type { CalendarEvent } from './event'
import { normalisationFor } from './from-event'
import { decidePull } from './pull-plan'
import { applyPulled, readSyncToken, recordEtag, removeVanished, saveSyncToken } from './pull-store'
import type { PushContext } from './push'

/**
 * Pulls what changed in Google Calendar since the last pull (README section 5.3): each changed event
 * is merged into Firestore, and events made or changed directly in Google Calendar are brought back
 * into shape (17:00, default reminders, category). Without a sync token, or when Google says it has
 * expired (410), it lists everything and drops synced entries whose event is gone.
 */

const isStatus = (error: unknown, status: number) => error instanceof CalendarApiError && error.status === status

async function normalise(context: PushContext, event: CalendarEvent, patch: CalendarEvent): Promise<void> {
  const target = { calendarId: context.config.calendarId, eventId: event.id ?? '' }
  try {
    const updated = await context.api.patchEvent(target, patch, event.etag ?? '')
    await recordEtag(target.eventId, context.uid, updated.etag ?? '')
  } catch (error) {
    // 412: it changed again meanwhile; the next pull sees the new version and normalises that one.
    if (!isStatus(error, 412)) {
      throw error
    }
  }
}

async function applyEvent(context: PushContext, event: CalendarEvent): Promise<void> {
  const { categories, config, uid } = context
  const decision = await applyPulled(event, entry => decidePull({ categories, entry, event, uid }))
  const fresh = decision.kind === 'create' || (decision.kind === 'update' && decision.normalise)
  if (!fresh) {
    return
  }
  const patch = normalisationFor(event, decision.draft, { categories, timeZone: config.timeZone })
  if (patch) {
    await normalise(context, event, patch)
  }
}

interface Listing {
  events: CalendarEvent[]
  nextSyncToken?: string
}

/** All pages of one listing; Google hands out pages one after another. */
async function listAll(context: PushContext, cursor: EventCursor, events: CalendarEvent[] = []): Promise<Listing> {
  const page: EventPage = await context.api.listEvents(context.config.calendarId, cursor)
  const all = [...events, ...page.items ?? []]
  return page.nextPageToken
    ? listAll(context, { ...cursor, pageToken: page.nextPageToken }, all)
    : { events: all, ...page.nextSyncToken ? { nextSyncToken: page.nextSyncToken } : {} }
}

async function pullPages(context: PushContext, syncToken: string | null): Promise<void> {
  const { events, nextSyncToken } = await listAll(context, syncToken ? { syncToken } : {})
  // One event after another, in Google's order: later changes to the same entry must land last.
  await events.reduce((previous, event) => previous.then(() => applyEvent(context, event)), Promise.resolve())
  if (!syncToken) {
    await removeVanished(new Set(events.map(event => event.id ?? '')))
  }
  if (nextSyncToken) {
    await saveSyncToken(context.uid, nextSyncToken)
  }
}

export async function pullChanges(context: PushContext): Promise<void> {
  const syncToken = await readSyncToken(context.uid)
  try {
    await pullPages(context, syncToken)
  } catch (error) {
    if (!syncToken || !isStatus(error, 410)) {
      throw error
    }
    await pullPages(context, null)
  }
}
