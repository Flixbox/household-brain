import { deleteField, runTransaction, serverTimestamp } from 'firebase/firestore'
import { db } from '@household-brain/firebase/firebase'
import type { Category } from '@household-brain/entries/lib/categories'
import type { DateOp } from './date-events'
import { draftFrom } from './from-event'
import type { Item } from './model'
import type { PushOutcome } from './push'
import { type PushRecord, errorFor, recordFor } from './record'
import { itemDoc } from './store'
import { itemFrom } from '@household-brain/entries/lib/documents'
import { logError } from '@household-brain/entries/lib/logs'
import { errorLogMessage } from '@household-brain/entries/lib/logs-messages'
import { stringify } from '@household-brain/core/lib/stringify'

// What a push to Google left behind, recorded on the entry. The app's own writes are in `store.ts`.

/** Applies a push record in a transaction; resolves to false when nothing could be recorded. */
const apply = async (item: Item, decide: (latest: Item | null) => PushRecord): Promise<boolean> =>
  runTransaction(db, async transaction => {
    const ref = itemDoc(item.id)
    const snapshot = await transaction.get(ref)
    const record = decide(snapshot.exists() ? itemFrom(snapshot.id, snapshot.data()) : null)
    if (record.kind === 'delete') {
      transaction.delete(ref)
    } else if (record.kind === 'update') {
      // Becoming "synced" counts as a change: a full sync running meanwhile must not drop the entry.
      transaction.update(ref, record.fields.sync === 'synced' ? { ...record.fields, updatedAt: serverTimestamp() } : record.fields)
    }
    return record.kind !== 'nothing'
  })

/** Records a push; Google's event after it is read back as a draft with the household's categories. */
export const recordPush = async (item: Item, outcome: PushOutcome, { uid, categories }: { uid: string, categories: readonly Category[] }) => {
  const remote = outcome.kind === 'synced' ? draftFrom(outcome.event, categories) : null
  return apply(item, latest => recordFor({ latest, outcome, pushed: item, remote, uid }))
}

export const recordPushError = async (item: Item, error: unknown) => {
  const message = stringify(error)
  return apply(item, latest => errorFor(latest, item, message)).then(recorded => {
    if (recorded) {
      logError(errorLogMessage('Google refused', item.title), item.id, message)
    }
    return recorded
  })
}

/**
 * Records in the ledger what a date write left in Google: the shape written (also when Google refused
 * it, with the error, so it isn't retried until the entry changes), or nothing after a delete. Skipped
 * when the entry is gone meanwhile.
 */
export const recordDateOp = async (item: Item, op: DateOp, error: string | null = null): Promise<void> =>
  runTransaction(db, async transaction => {
    const ref = itemDoc(item.id)
    if (!(await transaction.get(ref)).exists()) {
      return
    }
    const record = op.kind === 'delete' ? deleteField() : { shape: op.shape, ...typeof error === 'string' && error !== '' ? { error } : {} }
    transaction.update(ref, { [`dateEvents.${op.dateId}`]: record })
  })
