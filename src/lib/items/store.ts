import { arrayUnion, collection, deleteDoc, doc, runTransaction, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore'
import { auth, db } from '../firebase'
import { EDITABLE_FIELDS, type Item, type ItemDraft, changedFields } from './model'
import { newEventId } from './ids'
import type { PushOutcome } from './push'

export const itemsCollection = collection(db, 'items')
const itemDoc = (id: string) => doc(db, 'items', id)
const stamp = () => ({ updatedAt: serverTimestamp(), updatedBy: auth.currentUser?.uid ?? '' })

/** Saves a new entry locally, marked for pushing. Works offline. Returns its id. */
export async function addItem(draft: ItemDraft): Promise<string> {
  const id = newEventId()
  await setDoc(itemDoc(id), {
    ...draft, ...stamp(), dirty: [...EDITABLE_FIELDS], etags: {}, id, pendingOp: 'upsert', sync: 'pending', syncError: null,
  })
  return id
}

/** Saves an edit locally, remembering which fields changed so only those are pushed. */
export async function editItem(item: Item, draft: ItemDraft): Promise<void> {
  const changed = changedFields(item, draft)
  if (changed.length === 0) {
    return
  }
  await updateDoc(itemDoc(item.id), {
    ...draft, ...stamp(), dirty: arrayUnion(...changed), pendingOp: 'upsert', sync: 'pending', syncError: null,
  })
}

/** Marks an entry for deletion; one never pushed is simply removed. */
export async function removeItem(item: Item): Promise<void> {
  if (Object.keys(item.etags).length === 0 && item.pendingOp === 'upsert') {
    await deleteDoc(itemDoc(item.id))
    return
  }
  await updateDoc(itemDoc(item.id), { ...stamp(), pendingOp: 'delete', sync: 'pending', syncError: null })
}

/**
 * Records a finished push. If the entry was edited again while the push ran, only the etag is kept
 * and the entry stays pending, so the newer edit is pushed next.
 */
export async function recordPush(item: Item, outcome: PushOutcome, uid: string): Promise<void> {
  await runTransaction(db, async transaction => {
    const ref = itemDoc(item.id)
    const latest = (await transaction.get(ref)).data() as Item | undefined
    if (!latest) {
      return
    }
    const unchanged = latest.updatedAt && item.updatedAt ? latest.updatedAt.isEqual(item.updatedAt) : true
    if (outcome.kind === 'deleted') {
      if (unchanged) {
        transaction.delete(ref)
      }
      return
    }
    transaction.update(ref, unchanged
      ? { [`etags.${uid}`]: outcome.etag, dirty: [], pendingOp: null, sync: 'synced', syncError: null }
      : { [`etags.${uid}`]: outcome.etag })
  })
}

export async function recordPushError(item: Item, message: string): Promise<void> {
  await updateDoc(itemDoc(item.id), { sync: 'error', syncError: message })
}

export async function retryItem(item: Item): Promise<void> {
  await updateDoc(itemDoc(item.id), { sync: 'pending', syncError: null })
}
