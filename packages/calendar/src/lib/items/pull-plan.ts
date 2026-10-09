import type { Category } from '@household-brain/calendar/lib/categories'
import type { CalendarEvent } from './event'
import { draftFrom, isRecurring } from './from-event'
import { EDITABLE_FIELDS, type Item, type ItemDraft, changedFields, draftOf } from './model'
import { isDate } from './dates'

/** What to do with one event from Google Calendar. */
export type PullDecision =
  | { kind: 'skip' }
  | { kind: 'delete' }
  /** A new entry; `draft` also tells the caller what to normalise. */
  | { kind: 'create', draft: ItemDraft, fields: Record<string, unknown> }
  /**
   * Overwrite the entry with Google's version (`normalise`: the entry has no local edits), merge it
   * into local edits, or, for the other person's push of the version it already holds, change nothing
   * (`fields` empty). `ownCopy`: this person's own copy of the event (reminders are per person) still
   * has to follow `draft`, and their etag is recorded only once it does (`fixOwnReminders` in the puller).
   */
  | { kind: 'update', draft: ItemDraft, fields: Record<string, unknown>, normalise: boolean, ownCopy?: boolean }

export interface PullInput {
  /** The entry with this event's id, or null. */
  entry: Item | null
  event: CalendarEvent
  uid: string
  categories: readonly Category[]
  /** A full listing after the reading rules changed (#97): unchanged events are read again. */
  recheck?: boolean
}

const hasLocalEdits = (entry: Item) => entry.sync !== 'synced' && entry.pendingOp === 'upsert'

const deleted = ({ entry }: PullInput): PullDecision =>
  // An entry with unsent edits wins: its push writes the event back. Otherwise the deletion stands.
  !entry || hasLocalEdits(entry) ? { kind: 'skip' } : { kind: 'delete' }

/**
 * The other person's push of the version this entry already holds: nothing to merge. This person's
 * etag is recorded once their own copy fits (`ownCopy`), so an interrupted fix is tried again.
 */
const rememberEtag = (event: CalendarEvent): PullDecision => ({ draft: draftFrom(event, []), fields: {}, kind: 'update', normalise: false, ownCopy: true })

const merged = (entry: Item, draft: ItemDraft): PullDecision => {
  const theirs = EDITABLE_FIELDS.filter(field => !entry.dirty.includes(field))
  // This person's etag and the version are recorded only after their own copy is checked (`ownCopy`).
  const fields = Object.fromEntries(theirs.map(field => [field, draft[field]]))
  // The entry as it is after the merge: this person's own copy of the event follows it (#74). Their
  // own push only rewrites the reminders when its own edits touched the status or the reminders.
  const local = draftOf(entry)
  const mine = { ...draft, ...Object.fromEntries(entry.dirty.map(field => [field, local[field]])) }
  return { draft: mine, fields, kind: 'update', normalise: false, ownCopy: true }
}

const changed = ({ entry, event, categories }: PullInput): PullDecision => {
  const draft = draftFrom(event, categories)
  const googleUpdated = event.updated ?? ''
  const synced = { dirty: [], googleUpdated, pendingOp: null, sync: 'synced', syncError: null }
  if (!entry) {
    // The etag for this person is recorded only after the event is adjusted (or found fine): until
    // someone's is, the same version is adjusted again (`decidePull`).
    return { draft, fields: { ...draft, ...synced, etags: {}, id: event.id }, kind: 'create' }
  }
  if (hasLocalEdits(entry)) {
    return merged(entry, draft)
  }
  return { draft, fields: { ...draft, ...synced }, kind: 'update', normalise: true }
}

/** RFC 3339 UTC times compare as text once fractional seconds are always present ("…:05Z" → "…:05.000Z"). */
const comparable = (value: string | undefined) => (value && !value.includes('.') ? value.replace('Z', '.000Z') : value ?? '')

/**
 * Compares Google's `updated` with what the entry already has: "older" (a listing from before a
 * push), "same" (the version the entry holds, e.g. the other person's push), or "newer".
 */
const versionOf = (entry: Item | null, event: CalendarEvent): 'older' | 'same' | 'newer' => {
  const mine = comparable(entry?.googleUpdated)
  const theirs = comparable(event.updated)
  if (!mine || !theirs) {
    return 'newer'
  }
  if (theirs < mine) {
    return 'older'
  }
  return theirs === mine ? 'same' : 'newer'
}

/**
 * A deleted event of an entry without a due date and nothing to send: the app deleted it on purpose
 * when the date was removed. (A live one newer than that, e.g. restored from Google Calendar's trash,
 * goes the usual way and brings its date back.)
 */
const isUnscheduledDeletion = (entry: Item | null, event: CalendarEvent) =>
  event.status === 'cancelled' && entry !== null && !isDate(entry.dueDate) && !hasLocalEdits(entry)

/**
 * Read again under newer rules (#97), an event the entry already holds can say something else now,
 * e.g. a tag that names a category: then Google's version goes the full way, so the entry and the
 * event follow. Not while the entry has edits waiting to be sent.
 */
const readsDifferently = ({ entry, event, categories, recheck }: PullInput) =>
  Boolean(recheck && entry && !hasLocalEdits(entry) && changedFields(draftOf(entry), draftFrom(event, categories)).length > 0)

/** Our own write coming back, or an entry whose deletion is about to be pushed. */
const isSettled = (entry: Item | null, event: CalendarEvent, uid: string) =>
  entry !== null && (entry.etags[uid] === event.etag || entry.pendingOp === 'delete')

/**
 * Decides how one changed event from Google Calendar lands in Firestore:
 * - repeating events, and versions older than the entry's: skip;
 * - the version the entry already holds: only remember its etag for this person;
 * - in a re-check after the rules changed, an entry without local edits that the event now reads
 *   differently for: Google's version replaces it, and the event is brought into shape;
 * - our own write coming back (same etag as recorded for this person): skip;
 * - unknown: a new, synced entry;
 * - an entry with unsent local edits: Google's values for every field not edited locally;
 * - an entry waiting to be deleted: skip (the delete is pushed);
 * - the deleted event of an entry without a due date and nothing to send: skip (deleted on purpose);
 * - a deleted event: removes the entry, unless the entry has unsent edits;
 * - otherwise: Google's version replaces the entry.
 */
export const decidePull = (input: PullInput): PullDecision => {
  const { entry, event, uid } = input
  const version = versionOf(entry, event)
  const cancelled = event.status === 'cancelled'
  if (version === 'older' || (isRecurring(event) && !cancelled) || isUnscheduledDeletion(entry, event)) {
    return { kind: 'skip' }
  }
  if (cancelled) {
    return deleted(input)
  }
  if (isSettled(entry, event, uid) && !readsDifferently(input)) {
    return { kind: 'skip' }
  }
  // An entry nobody has recorded an etag for came from Google and was never adjusted (an interrupted
  // pull, or a patch that failed): the same version goes the full way again, so it is adjusted.
  return version === 'same' && entry && Object.keys(entry.etags).length > 0 && !readsDifferently(input) ? rememberEtag(event) : changed(input)
}
