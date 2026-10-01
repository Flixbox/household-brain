import type { Category } from '../categories'
import type { CalendarEvent } from './event'
import { draftFrom, isRecurring } from './from-event'
import { EDITABLE_FIELDS, type Item, type ItemDraft } from './model'

/** What to do with one event from Google Calendar. */
export type PullDecision =
  | { kind: 'skip' }
  | { kind: 'delete' }
  /** A new entry; `draft` also tells the caller what to normalise. */
  | { kind: 'create', draft: ItemDraft, fields: Record<string, unknown> }
  /** Overwrite the entry with Google's version (`normalise`: the entry has no local edits). */
  | { kind: 'update', draft: ItemDraft, fields: Record<string, unknown>, normalise: boolean }

export interface PullInput {
  /** The entry with this event's id, or null. */
  entry: Item | null
  event: CalendarEvent
  uid: string
  categories: readonly Category[]
}

const hasLocalEdits = (entry: Item) => entry.sync !== 'synced' && entry.pendingOp === 'upsert'

function deleted({ entry }: PullInput): PullDecision {
  // An entry with unsent edits wins: its push writes the event back. Otherwise the deletion stands.
  return !entry || hasLocalEdits(entry) ? { kind: 'skip' } : { kind: 'delete' }
}

/** The other person's push of the version this entry already holds: just this person's etag. */
function rememberEtag(event: CalendarEvent, uid: string): PullDecision {
  return { draft: draftFrom(event, []), fields: { [`etags.${uid}`]: event.etag ?? '' }, kind: 'update', normalise: false }
}

function merged(entry: Item, draft: ItemDraft, version: Record<string, string>): PullDecision {
  const theirs = EDITABLE_FIELDS.filter(field => !entry.dirty.includes(field))
  const fields = { ...Object.fromEntries(theirs.map(field => [field, draft[field]])), ...version }
  return { draft, fields, kind: 'update', normalise: false }
}

function changed({ entry, event, uid, categories }: PullInput): PullDecision {
  const draft = draftFrom(event, categories)
  const etag = event.etag ?? ''
  const googleUpdated = event.updated ?? ''
  const synced = { dirty: [], googleUpdated, pendingOp: null, sync: 'synced', syncError: null }
  if (!entry) {
    return { draft, fields: { ...draft, ...synced, etags: { [uid]: etag }, id: event.id }, kind: 'create' }
  }
  if (hasLocalEdits(entry)) {
    return merged(entry, draft, { [`etags.${uid}`]: etag, googleUpdated })
  }
  return { draft, fields: { ...draft, ...synced, [`etags.${uid}`]: etag }, kind: 'update', normalise: true }
}

/** RFC 3339 UTC times compare as text once fractional seconds are always present ("…:05Z" → "…:05.000Z"). */
const comparable = (value: string | undefined) => (value && !value.includes('.') ? value.replace('Z', '.000Z') : value ?? '')

/**
 * Compares Google's `updated` with what the entry already has: "older" (a listing from before a
 * push), "same" (the version the entry holds, e.g. the other person's push), or "newer".
 */
function versionOf(entry: Item | null, event: CalendarEvent): 'older' | 'same' | 'newer' {
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

/** Our own write coming back, or an entry whose deletion is about to be pushed. */
const isSettled = (entry: Item | null, event: CalendarEvent, uid: string) =>
  entry !== null && (entry.etags[uid] === event.etag || entry.pendingOp === 'delete')

/**
 * Decides how one changed event from Google Calendar lands in Firestore:
 * - repeating events, and versions older than the entry's: skip;
 * - the version the entry already holds: only remember its etag for this person;
 * - our own write coming back (same etag as recorded for this person): skip;
 * - unknown: a new, synced entry;
 * - an entry with unsent local edits: Google's values for every field not edited locally;
 * - an entry waiting to be deleted: skip (the delete is pushed);
 * - a deleted event: removes the entry, unless the entry has unsent edits;
 * - otherwise: Google's version replaces the entry.
 */
export function decidePull(input: PullInput): PullDecision {
  const { entry, event, uid } = input
  const version = versionOf(entry, event)
  const cancelled = event.status === 'cancelled'
  if (version === 'older' || (isRecurring(event) && !cancelled)) {
    return { kind: 'skip' }
  }
  if (cancelled) {
    return deleted(input)
  }
  if (isSettled(entry, event, uid)) {
    return { kind: 'skip' }
  }
  return version === 'same' && entry ? rememberEtag(event, uid) : changed(input)
}
