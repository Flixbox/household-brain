import type { Item } from './model'
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
}

export function recordFor({ latest, pushed, outcome, uid }: PushResult): PushRecord {
  if (!latest) {
    return { kind: 'nothing' }
  }
  const unchanged = latest.rev === pushed.rev
  if (outcome.kind === 'deleted') {
    return unchanged ? { kind: 'delete' } : { kind: 'nothing' }
  }
  const etag = { [`etags.${uid}`]: outcome.etag }
  return {
    fields: unchanged ? { ...etag, dirty: [], pendingOp: null, sync: 'synced', syncError: null } : etag,
    kind: 'update',
  }
}

/** A failed push is only recorded if nothing changed meanwhile; a newer change gets its own attempt. */
export function errorFor(latest: Item | null, pushed: Item, message: string): PushRecord {
  return latest?.rev === pushed.rev
    ? { fields: { sync: 'error', syncError: message }, kind: 'update' }
    : { kind: 'nothing' }
}
