import { CalendarApiError, type EventCursor, type EventPage } from '../calendar/api'
import type { CalendarEvent } from './event'
import { normalisationFor } from './from-event'
import { decidePull } from './pull-plan'
import { applyPulled, dropStray, markSchema, readEntryFromServer, readSyncToken, recordEtag, removeVanished, saveSyncToken, serverNow } from './pull-store'
import { DATE_EVENTS_SCHEMA, entryOfEvent, isOrphanDate } from './date-events'
import type { PushContext } from './push'
import { isTransient } from './transient'

/**
 * Pulls what changed in Google Calendar since the last pull (docs/sync.md): each changed event
 * is merged into Firestore, and events made or changed in Google Calendar through the app's
 * categories are brought back into shape (17:00, default reminders, category). Without a sync token,
 * or when Google says it has expired (410), it lists everything and drops synced entries whose event
 * is gone.
 *
 * Returns the problems that didn't stop the pull: an event that couldn't be normalised is reported
 * and skipped, so one awkward event never blocks every later change.
 */

const isStatus = (error: unknown, status: number) => error instanceof CalendarApiError && error.status === status
const describe = (error: unknown) => (error instanceof Error ? error.message : String(error))

async function normalise(context: PushContext, event: CalendarEvent, patch: CalendarEvent): Promise<string | null> {
  const target = { calendarId: context.config.calendarId, eventId: event.id ?? '' }
  try {
    const updated = await context.api.patchEvent(target, patch, event.etag ?? '')
    await recordEtag(target.eventId, context.uid, updated)
    return null
  } catch (error) {
    // 412: it changed again meanwhile; the next pull sees the new version and normalises that one.
    if (isStatus(error, 412)) {
      return null
    }
    // Network trouble, rate limits, server errors: fail the pull so it is retried, token unchanged.
    if (isTransient(error)) {
      throw error
    }
    return `Couldn't adjust "${event.summary ?? event.id}" in Google Calendar: ${describe(error)}`
  }
}

/**
 * An extra date's event belongs to its entry and is never an entry of its own (#34). One whose entry
 * or date is gone is deleted in Google, so its reminders stop.
 */
async function applyDateEvent(context: PushContext, event: CalendarEvent, entryId: string): Promise<string | null> {
  const eventId = event.id ?? ''
  await dropStray(eventId)
  const dateId = eventId.slice(entryId.length + 1)
  if (event.status === 'cancelled' || !isOrphanDate(await readEntryFromServer(entryId), dateId)) {
    return null
  }
  return context.api.deleteEvent(context.config.calendarId, eventId).then(() => null, (error: unknown) => {
    if (isTransient(error)) {
      throw error
    }
    return `Couldn't remove the leftover "${event.summary ?? eventId}" from Google Calendar: ${describe(error)}`
  })
}

/** An entry's own event: merged into the entry, and brought back into shape when needed. */
async function applyEntryEvent(context: PushContext, event: CalendarEvent): Promise<string | null> {
  const { categories, config, uid } = context
  const decision = await applyPulled(event, entry => decidePull({ categories, entry, event, uid }))
  const fresh = decision.kind === 'create' || (decision.kind === 'update' && decision.normalise)
  // Created and replaced entries get this person's etag only here, after the adjustment.
  if (!fresh) {
    return null
  }
  const patch = normalisationFor(event, decision.draft, { categories, timeZone: config.timeZone })
  if (patch) {
    return normalise(context, event, patch)
  }
  await recordEtag(event.id ?? '', uid, event)
  return null
}

function applyEvent(context: PushContext, event: CalendarEvent): Promise<string | null> {
  const entryId = entryOfEvent(event)
  return entryId ? applyDateEvent(context, event, entryId) : applyEntryEvent(context, event)
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

async function pullPages(context: PushContext, syncToken: string | null): Promise<string[]> {
  const listedSince = syncToken ? null : await serverNow(context.uid)
  const { events, nextSyncToken } = await listAll(context, syncToken ? { syncToken } : {})
  // One event after another, in Google's order: later changes to the same entry must land last.
  const problems = await events.reduce<Promise<string[]>>(async (previous, event) => {
    const found = await previous
    const problem = await applyEvent(context, event)
    return problem ? [...found, problem] : found
  }, Promise.resolve([]))
  if (listedSince) {
    await removeVanished(new Set(events.map(event => event.id ?? '')), listedSince)
  }
  if (nextSyncToken && nextSyncToken !== syncToken) {
    await saveSyncToken(context.uid, nextSyncToken)
  }
  return problems
}

/** People whose schema marker this app already wrote since it started. */
const marked = new Set<string>()

export async function pullChanges(context: PushContext): Promise<string[]> {
  // Best effort and not awaited: offline it would wait for the server, and a failure mustn't stop
  // the pull. Tried again next session (or next pull) if it fails.
  if (!marked.has(context.uid)) {
    marked.add(context.uid)
    markSchema(context.uid, DATE_EVENTS_SCHEMA).catch(() => marked.delete(context.uid))
  }
  const syncToken = await readSyncToken(context.uid)
  try {
    return await pullPages(context, syncToken)
  } catch (error) {
    if (!syncToken || !isStatus(error, 410)) {
      throw error
    }
    return pullPages(context, null)
  }
}
