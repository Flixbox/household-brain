import { collection, onSnapshot } from 'firebase/firestore'
import { db } from '@household-brain/firebase/firebase'
import { type DateOp, dateEventsAllowed, planDates } from './date-events'
import { pushDateOp } from './date-push'
import type { Item } from './model'
import type { PushContext } from './push'
import { recordDateOp } from './store'
import { isTransient } from './transient'

/** One write for an extra date's event, with the entry it belongs to. */
export interface DateWork {
  item: Item
  op: DateOp
}

/** A write is the step from what the ledger says to the target, so going back to an earlier shape is a new one. */
const keyOf = ({ item, op }: DateWork) =>
  `${item.id}/${op.dateId}/${item.dateEvents?.[op.dateId]?.shape ?? ''}>${op.kind === 'upsert' ? op.shape : 'deleted'}`

/**
 * Writes carried out in this session. Until the recorded ledger arrives through the snapshot, the
 * plan still lists them; this keeps them from going out twice. A failed delete also stays here, so
 * it is tried again only in the next session.
 */
const done = new Set<string>()

/** Whether every person's app recognises date events, so they may be written (`dateEventsAllowed`). */
let open = false

/** Follows the `syncState` collection, which says which app versions are in use; calls `onChange` after each update. */
export const watchDateGate = (onChange: () => unknown) => onSnapshot(collection(db, 'syncState'), { includeMetadataChanges: true }, snapshot => {
  // Only the server's answer counts: the local cache may hold just this person's document.
  open = !snapshot.metadata.fromCache && dateEventsAllowed(snapshot.docs.map(entry => entry.data()))
  onChange()
}, () => {
  open = false
})

/**
 * The next date event to write, while the gate is open: for entries that are synced (their own event,
 * if they have a due date, is in Google) and have no local change waiting.
 */
export function nextDateWork(items: readonly Item[], context: PushContext, ready: (item: Item) => boolean): DateWork | null {
  if (!open) {
    return null
  }
  const eventContext = { categories: context.categories, timeZone: context.config.timeZone }
  for (const item of items.filter(ready)) {
    const op = planDates(item, eventContext).find(candidate => !done.has(keyOf({ item, op: candidate })))
    if (op) {
      return { item, op }
    }
  }
  return null
}

/**
 * Writes one date event and records it. Throws on a transient failure (offline, rate limit), for the
 * outbox to retry later; a definite refusal is recorded with the error instead.
 */
export async function runDateWork(context: PushContext, work: DateWork): Promise<void> {
  const refusal = await pushDateOp(context, work.item, work.op).then(() => null, (error: unknown) => {
    if (isTransient(error)) {
      throw error
    }
    return error instanceof Error ? error.message : String(error)
  })
  done.add(keyOf(work))
  if (refusal === null || work.op.kind === 'upsert') {
    await recordDateOp(work.item, work.op, refusal)
  }
}

/** Forgets this session's writes and the gate (sign-out). */
export function forgetDateWork() {
  done.clear()
  open = false
}
