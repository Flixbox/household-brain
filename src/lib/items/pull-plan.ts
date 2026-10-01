import type { Category } from '../categories'
import type { CalendarEvent } from './event'
import { draftFrom } from './from-event'
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

/**
 * Decides how one changed event from Google Calendar lands in Firestore:
 * - our own write coming back (same etag as recorded for this user): skip;
 * - unknown: a new, synced entry;
 * - an entry with unsent local edits: Google's values for every field not edited locally;
 * - an entry waiting to be deleted: skip (the delete is pushed);
 * - otherwise: Google's version replaces the entry.
 */
function changed({ entry, event, uid, categories }: PullInput): PullDecision {
  const draft = draftFrom(event, categories)
  const etag = event.etag ?? ''
  if (!entry) {
    return {
      draft,
      fields: { ...draft, dirty: [], etags: { [uid]: etag }, id: event.id, pendingOp: null, sync: 'synced', syncError: null },
      kind: 'create',
    }
  }
  if (hasLocalEdits(entry)) {
    const theirs = EDITABLE_FIELDS.filter(field => !entry.dirty.includes(field))
    const fields = { ...Object.fromEntries(theirs.map(field => [field, draft[field]])), [`etags.${uid}`]: etag }
    return { draft, fields, kind: 'update', normalise: false }
  }
  const fields = { ...draft, [`etags.${uid}`]: etag, dirty: [], pendingOp: null, sync: 'synced', syncError: null }
  return { draft, fields, kind: 'update', normalise: true }
}

export function decidePull(input: PullInput): PullDecision {
  const { entry, event, uid } = input
  if (event.status === 'cancelled') {
    return deleted(input)
  }
  const ownEcho = entry !== null && entry.etags[uid] === event.etag
  return ownEcho || entry?.pendingOp === 'delete' ? { kind: 'skip' } : changed(input)
}
