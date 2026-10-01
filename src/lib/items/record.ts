import type { Item, ItemDraft } from './model'
import type { PushOutcome } from './push'

/** What to write after a push, given the entry as it is now (`latest`) and as it was pushed (`pushed`). */
export type PushRecord =
  | { kind: 'delete' }
  | { kind: 'update', fields: Record<string, unknown> }
  | { kind: 'nothing' }

/**
 * Decides how to record a finished push. If the entry changed while the push ran (another `rev`),
 * only the new etag is kept and the entry stays pending, so the newer change is pushed next.
 */
export interface PushResult {
  /** The entry as it is now; null when it no longer exists. */
  latest: Item | null
  /** The entry as it was pushed. */
  pushed: Item
  outcome: PushOutcome
  uid: string
  /** The entry fields of Google's event after the write, when there is one. */
  remote: ItemDraft | null
}

export function recordFor({ latest, pushed, outcome, uid, remote }: PushResult): PushRecord {
  if (!latest) {
    return { kind: 'nothing' }
  }
  const unchanged = latest.rev === pushed.rev
  if (outcome.kind === 'deleted') {
    return unchanged ? { kind: 'delete' } : { kind: 'nothing' }
  }
  const etag = { [`etags.${uid}`]: outcome.event.etag ?? '' }
  // Changed meanwhile: fields that were just pushed and haven't changed since are in Google now, so
  // they are no longer unsent changes; a later push must not send them again over newer values.
  const stillDirty = () => latest.dirty.filter(field => !(pushed.dirty.includes(field) && latest[field] === pushed[field]))
  // Google's reply holds the whole event: the fields just written, plus anything changed in Google
  // meanwhile. Taking all of it keeps the entry identical to the event.
  return {
    fields: unchanged
      ? { ...remote, ...etag, dirty: [], googleUpdated: outcome.event.updated ?? '', pendingOp: null, sync: 'synced', syncError: null }
      : { ...etag, dirty: stillDirty() },
    kind: 'update',
  }
}

/** A failed push is only recorded if nothing changed meanwhile; a newer change gets its own attempt. */
export function errorFor(latest: Item | null, pushed: Item, message: string): PushRecord {
  return latest?.rev === pushed.rev
    ? { fields: { sync: 'error', syncError: message }, kind: 'update' }
    : { kind: 'nothing' }
}
