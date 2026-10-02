import { CalendarApiError, type EventCursor, type EventPage } from '@household-brain/calendar/lib/calendar/api'
import type { CalendarEvent } from './event'
import { normalisationFor, ownRemindersFix } from './from-event'
import { type PullDecision, decidePull } from './pull-plan'
import { applyDateChange, applyPulled, dropStray, forgetDateEvents, markSchema, readEntryFromCache, readEntryFromServer, readSyncToken, recordEtag, removeVanished, saveSyncToken, serverNow } from './pull-store'
import { APP_SCHEMA, entryOfEvent, isOrphanDate } from './date-events'
import { deleteDateEvents } from './date-push'
import { dateEventChange } from './date-pull'
import type { Item, ItemDraft } from './model'
import type { PushContext } from './push'
import { isTransient } from './transient'

/**
 * Pulls what changed in Google Calendar since the last pull: each changed event
 * is merged into Firestore, and events made or changed in Google Calendar through the app's
 * categories are brought back into shape (17:00, the entry's reminders, category). Without a sync token,
 * or when Google says it has expired (410), it lists everything and drops synced entries whose event
 * is gone.
 *
 * Returns the problems that didn't stop the pull: an event that couldn't be normalised is reported
 * and skipped, so one awkward event never blocks every later change.
 */

const isStatus = (error: unknown, status: number) => error instanceof CalendarApiError && error.status === status
const describe = (error: unknown) => (error instanceof Error ? error.message : String(error))

const normalise = async (context: PushContext, event: CalendarEvent, patch: CalendarEvent): Promise<string | null> => {
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

/** Transient failures fail the pull (it is retried); others are reported and the pull goes on. */
const reportUnlessTransient = (what: string) => (error: unknown) => {
  if (isTransient(error)) {
    throw error
  }
  return `Couldn't remove ${what} from Google Calendar: ${describe(error)}`
}

/** Before an entry goes here, its extra dates' events go from Google, so their reminders stop. */
const removeDateEvents = (context: PushContext, entry: Item): Promise<string | null> =>
  deleteDateEvents(context, entry).then(() => null, reportUnlessTransient(`the other dates of "${entry.title}"`))

/** The entry a date event belongs to: the cached copy when it still has the date, else the server's. */
const ownerOf = async (entryId: string, dateId: string): Promise<Item | null> => {
  const cached = await readEntryFromCache(entryId)
  return cached && !isOrphanDate(cached, dateId) ? cached : readEntryFromServer(entryId)
}

/**
 * An extra date's event belongs to its entry and is never an entry of its own (#34). One whose entry
 * or date is gone is deleted in Google, e.g. an insert that landed unrecorded, or (in a full listing)
 * one whose entry an app version from before date events deleted.
 */
const applyDateEvent = async (context: PushContext, event: CalendarEvent, entryId: string): Promise<string | null> => {
  const eventId = event.id ?? ''
  const dateId = eventId.slice(entryId.length + 1)
  await dropStray(eventId)
  if (!isOrphanDate(await ownerOf(entryId, dateId), dateId)) {
    // Moved or deleted in Google: the entry follows; edited otherwise: it is put back (#34).
    const eventContext = { categories: context.categories, timeZone: context.config.timeZone }
    await applyDateChange(entryId, dateId, entry => dateEventChange({ dateId, event, item: entry }, eventContext))
    return null
  }
  return event.status === 'cancelled'
    ? null
    : context.api.deleteEvent(context.config.calendarId, eventId).then(() => null, reportUnlessTransient(`the leftover "${event.summary ?? eventId}"`))
}

/**
 * An entry's own event deleted in Google: when that deletes the entry here, its date events go first.
 * Null when nothing was removed, else the problem (or '' for none).
 */
const removeDatesOfDeleted = async (context: PushContext, event: CalendarEvent): Promise<string | null> => {
  const { categories, uid } = context
  const entry = event.status === 'cancelled' ? await readEntryFromServer(event.id ?? '') : null
  if (!entry || decidePull({ categories, entry, event, uid }).kind !== 'delete') {
    return null
  }
  return await removeDateEvents(context, entry) ?? ''
}

/**
 * An entry's own event: merged into the entry, and brought back into shape when needed. When it was
 * deleted in Google, the entry's date events go too; a failure there is reported, but the entry is
 * still removed (an incremental listing won't bring the deletion again).
 */
const applyEntryEvent = async (context: PushContext, event: CalendarEvent): Promise<string | null> => {
  const { categories, uid } = context
  const removed = await removeDatesOfDeleted(context, event)
  const decision = await applyPulled(event, entry => decidePull({ categories, entry, event, uid }))
  // Edited here between the read and the transaction, so the entry stays: its date events are rewritten.
  if (removed !== null && decision.kind !== 'delete') {
    await forgetDateEvents(event.id ?? '')
  }
  const settled = decision.kind === 'update' && decision.ownCopy
    ? await fixOwnReminders(context, event, decision.draft)
    : await settleEntryEvent(context, event, decision)
  return settled ?? (removed || null)
}

/** The other person's push, alone or merged into local edits: this person's reminders still follow the entry (#43, #74). */
const fixOwnReminders = async (context: PushContext, event: CalendarEvent, draft: ItemDraft): Promise<string | null> => {
  const fix = ownRemindersFix(event, draft, context.categories)
  if (fix) {
    // Records this person's etag once the fix is written. An interruption or a transient failure stops
    // the pull before its sync token is saved, so the fix runs again; Google refusing it doesn't.
    return normalise(context, event, fix)
  }
  await recordEtag(event.id ?? '', context.uid, event)
  return null
}

/** After merging: created and replaced entries are brought into shape and get this person's etag. */
const settleEntryEvent = async (context: PushContext, event: CalendarEvent, decision: PullDecision): Promise<string | null> => {
  const { categories, config, uid } = context
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

/** Applies events one after another, in Google's order, collecting the problems. */
const applyInOrder = (events: CalendarEvent[], apply: (event: CalendarEvent) => Promise<string | null>) =>
  events.reduce<Promise<string[]>>(async (previous, event) => {
    const found = await previous
    const problem = await apply(event)
    return problem ? [...found, problem] : found
  }, Promise.resolve([]))

interface Listing {
  events: CalendarEvent[]
  nextSyncToken?: string
}

/** All pages of one listing; Google hands out pages one after another. */
const listAll = async (context: PushContext, cursor: EventCursor, events: CalendarEvent[] = []): Promise<Listing> => {
  const page: EventPage = await context.api.listEvents(context.config.calendarId, cursor)
  const all = [...events, ...page.items ?? []]
  return page.nextPageToken
    ? listAll(context, { ...cursor, pageToken: page.nextPageToken }, all)
    : { events: all, ...page.nextSyncToken ? { nextSyncToken: page.nextSyncToken } : {} }
}

const pullPages = async (context: PushContext, syncToken: string | null): Promise<string[]> => {
  const listedSince = syncToken ? null : await serverNow(context.uid)
  const { events, nextSyncToken } = await listAll(context, syncToken ? { syncToken } : {})
  // Entries first, in Google's order (later changes to the same entry must land last), then the
  // extra dates' events, so each is judged against its entry as this listing left it.
  const problems = await applyInOrder(events.filter(event => !entryOfEvent(event)), event => applyEntryEvent(context, event))
  if (listedSince) {
    await removeVanished(new Set(events.map(event => event.id ?? '')), listedSince, async entry => {
      const problem = await removeDateEvents(context, entry)
      if (problem) {
        problems.push(problem)
      }
    })
  }
  const dateProblems = await applyInOrder(events.filter(event => entryOfEvent(event)), event => applyDateEvent(context, event, entryOfEvent(event) ?? ''))
  if (nextSyncToken && nextSyncToken !== syncToken) {
    await saveSyncToken(context.uid, nextSyncToken)
  }
  return [...problems, ...dateProblems]
}

/** People whose schema marker this app already wrote since it started. */
const marked = new Set<string>()

export const pullChanges = async (context: PushContext): Promise<string[]> => {
  // Best effort and not awaited: offline it would wait for the server, and a failure mustn't stop
  // the pull. Tried again next session (or next pull) if it fails.
  if (!marked.has(context.uid)) {
    marked.add(context.uid)
    markSchema(context.uid, APP_SCHEMA).catch(() => marked.delete(context.uid))
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
