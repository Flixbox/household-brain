import { arrayUnion, collection, deleteField, doc, runTransaction, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore'
import { auth, db } from '@household-brain/firebase/firebase'
import type { Category } from '@household-brain/calendar/lib/categories'
import type { DateOp } from './date-events'
import { draftFrom } from './from-event'
import type { EntryDate } from './dates'
import { EDITABLE_FIELDS, type Item, type ItemDraft, changedFields, draftOf } from './model'
import { newEventId } from './ids'
import type { PushOutcome } from './push'
import { type PushRecord, errorFor, recordFor } from './record'
import { itemFrom } from '@household-brain/calendar/lib/documents'

export const itemsCollection = collection(db, 'items')
const itemDoc = (id: string) => doc(db, 'items', id)
const stamp = () => ({ rev: newEventId(), updatedAt: serverTimestamp(), updatedBy: auth.currentUser?.uid ?? '' })

// The write functions return Firestore's promise, which only settles once the server confirmed the
// write. Callers must not wait for it before moving on: offline it never settles, yet the change is
// already in the local cache and shown everywhere.

/** Saves a new entry, marked for pushing. Returns its id at once and the server write separately. */
export const addItem = (draft: ItemDraft, extraDates: EntryDate[] = [], taskId?: string): { id: string, written: Promise<void> } => {
  const id = newEventId()
  const written = setDoc(itemDoc(id), {
    ...draft, ...stamp(), ...taskId ? { taskId } : {}, dirty: [...EDITABLE_FIELDS], etags: {}, extraDates, id, pendingOp: 'upsert', sync: 'pending', syncError: null,
  })
  return { id, written }
}

/**
 * Saves an edit. Only fields that differ from what the form opened with are written and pushed, so
 * a change the other person made meanwhile to another field is kept.
 */
export const editItem = (id: string, opened: ItemDraft, draft: ItemDraft): Promise<void> => {
  const changed = changedFields(opened, draft)
  if (changed.length === 0) {
    return Promise.resolve()
  }
  const values = Object.fromEntries(changed.map(field => [field, draft[field]]))
  return updateDoc(itemDoc(id), {
    ...values, ...stamp(), dirty: arrayUnion(...changed), pendingOp: 'upsert', sync: 'pending', syncError: null,
  })
}

/** Sets an entry's status (e.g. done after a swipe): only the status is written and pushed. */
export const setItemStatus = (item: Item, status: Item['status']): Promise<void> => {
  const before = draftOf(item)
  return editItem(item.id, before, { ...before, status })
}

/**
 * Saves an entry's extra dates. The outbox then brings their Google events in line (`planDates`),
 * without marking the entry pending: its own event doesn't change.
 */
export const setExtraDates = (id: string, extraDates: EntryDate[]): Promise<void> =>
  updateDoc(itemDoc(id), { ...stamp(), extraDates })

/**
 * Marks an entry for deletion. Always through Google, even for an entry that looks unsynced: its
 * insert may have reached Google without the answer arriving. Deleting a missing event is harmless.
 */
export const removeItem = (id: string): Promise<void> =>
  updateDoc(itemDoc(id), { ...stamp(), pendingOp: 'delete', sync: 'pending', syncError: null })

/** Applies a push record in a transaction; resolves to false when nothing could be recorded. */
const apply = (item: Item, decide: (latest: Item | null) => PushRecord): Promise<boolean> =>
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
export const recordPush = (item: Item, outcome: PushOutcome, { uid, categories }: { uid: string, categories: readonly Category[] }) => {
  const remote = outcome.kind === 'synced' ? draftFrom(outcome.event, categories) : null
  return apply(item, latest => recordFor({ latest, outcome, pushed: item, remote, uid }))
}

export const recordPushError = (item: Item, message: string) => apply(item, latest => errorFor(latest, item, message))

export const retryItem = (item: Item): Promise<void> =>
  updateDoc(itemDoc(item.id), { sync: 'pending', syncError: null })

/**
 * Records in the ledger what a date write left in Google: the shape written (also when Google refused
 * it, with the error, so it isn't retried until the entry changes), or nothing after a delete. Skipped
 * when the entry is gone meanwhile.
 */
export const recordDateOp = (item: Item, op: DateOp, error: string | null = null): Promise<void> =>
  runTransaction(db, async transaction => {
    const ref = itemDoc(item.id)
    if (!(await transaction.get(ref)).exists()) {
      return
    }
    const record = op.kind === 'delete' ? deleteField() : { shape: op.shape, ...error ? { error } : {} }
    transaction.update(ref, { [`dateEvents.${op.dateId}`]: record })
  })
