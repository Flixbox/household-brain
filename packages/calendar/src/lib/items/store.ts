import { arrayUnion, collection, doc, runTransaction, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore'
import { auth, db } from '@household-brain/firebase/firebase'
import { EDITABLE_FIELDS, type Item, type ItemDraft, changedFields } from './model'
import { newEventId } from './ids'
import type { PushOutcome } from './push'
import { type PushRecord, errorFor, recordFor } from './record'

export const itemsCollection = collection(db, 'items')
const itemDoc = (id: string) => doc(db, 'items', id)
export const stamp = () => ({ rev: newEventId(), updatedAt: serverTimestamp(), updatedBy: auth.currentUser?.uid ?? '' })

// The write functions return Firestore's promise, which only settles once the server confirmed the
// write. Callers must not wait for it before moving on: offline it never settles, yet the change is
// already in the local cache and shown everywhere.

/** Saves a new entry, marked for pushing. Returns its id at once and the server write separately. */
export function addItem(draft: ItemDraft): { id: string, written: Promise<void> } {
  const id = newEventId()
  const written = setDoc(itemDoc(id), {
    ...draft, ...stamp(), dirty: [...EDITABLE_FIELDS], etags: {}, id, pendingOp: 'upsert', sync: 'pending', syncError: null,
  })
  return { id, written }
}

/**
 * Saves an edit. Only fields that differ from what the form opened with are written and pushed, so
 * a change the other person made meanwhile to another field is kept.
 */
export function editItem(id: string, opened: ItemDraft, draft: ItemDraft): Promise<void> {
  const changed = changedFields(opened, draft)
  if (changed.length === 0) {
    return Promise.resolve()
  }
  const values = Object.fromEntries(changed.map(field => [field, draft[field]]))
  return updateDoc(itemDoc(id), {
    ...values, ...stamp(), dirty: arrayUnion(...changed), pendingOp: 'upsert', sync: 'pending', syncError: null,
  })
}

/**
 * Marks an entry for deletion. Always through Google, even for an entry that looks unsynced: its
 * insert may have reached Google without the answer arriving. Deleting a missing event is harmless.
 */
export function removeItem(id: string): Promise<void> {
  return updateDoc(itemDoc(id), { ...stamp(), pendingOp: 'delete', sync: 'pending', syncError: null })
}

/** Applies a push record in a transaction; resolves to false when nothing could be recorded. */
function apply(item: Item, decide: (latest: Item | null) => PushRecord): Promise<boolean> {
  return runTransaction(db, async transaction => {
    const ref = itemDoc(item.id)
    const snapshot = await transaction.get(ref)
    const record = decide(snapshot.exists() ? snapshot.data() as Item : null)
    if (record.kind === 'delete') {
      transaction.delete(ref)
    } else if (record.kind === 'update') {
      // Becoming "synced" counts as a change: a full sync running meanwhile must not drop the entry.
      transaction.update(ref, record.fields.sync === 'synced' ? { ...record.fields, updatedAt: serverTimestamp() } : record.fields)
    }
    return record.kind !== 'nothing'
  })
}

export const recordPush = (item: Item, outcome: PushOutcome, { uid, remote }: { uid: string, remote: ItemDraft | null }) =>
  apply(item, latest => recordFor({ latest, outcome, pushed: item, remote, uid }))

export const recordPushError = (item: Item, message: string) => apply(item, latest => errorFor(latest, item, message))

export function retryItem(item: Item): Promise<void> {
  return updateDoc(itemDoc(item.id), { sync: 'pending', syncError: null })
}
