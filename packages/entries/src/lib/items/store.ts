import { arrayUnion, collection, doc, runTransaction, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore'
import { auth, db } from '@household-brain/firebase/firebase'
import type { EntryDate } from './dates'
import { EDITABLE_FIELDS, type Item, changedFields, draftOf } from './model'
import { type ItemDraft, checkedDraft } from './draft'
import { newEventId } from './ids'
import { logEvent } from '@household-brain/entries/lib/logs'
import { changedDetail, entryLogMessage } from '@household-brain/entries/lib/logs-messages'

export const itemsCollection = collection(db, 'items')
export const itemDoc = (id: string) => doc(db, 'items', id)
const stamp = () => ({ rev: newEventId(), updatedAt: serverTimestamp(), updatedBy: auth.currentUser?.uid ?? '' })

// The write functions return Firestore's promise, which only settles once the server confirmed the
// write. Callers must not wait for it before moving on: offline it never settles, yet the change is
// already in the local cache and shown everywhere. A draft that fails the entry schema (`draft.ts`)
// is refused, as a failed write: drafts from Google are repaired before they get here.

/** Saves a new entry, marked for pushing. Returns its id at once and the server write separately. */
const newEntry = (id: string, draft: ItemDraft, extraDates: EntryDate[]) => ({
  ...draft, ...stamp(), dirty: [...EDITABLE_FIELDS], etags: {}, extraDates, id, pendingOp: 'upsert', sync: 'pending', syncError: null,
})

export const addItem = (draft: ItemDraft, extraDates: EntryDate[] = []): { id: string, written: Promise<void> } => {
  const id = newEventId()
  const written = Promise.try(() => checkedDraft(draft)).then(async valid => {
    logEvent(entryLogMessage('Added', valid.title), id)
    return setDoc(itemDoc(id), newEntry(id, valid, extraDates))
  })
  return { id, written }
}

/**
 * Saves the entry a Google Task becomes (#118), unless it already exists: its id comes from the task,
 * so a second device importing the same task meanwhile adds nothing. A transaction needs the server,
 * so offline it fails at once instead of waiting.
 */
export const addImportedItem = async (id: string, draft: ItemDraft, taskId: string): Promise<boolean> => {
  const valid = checkedDraft(draft)
  return runTransaction(db, async transaction => {
    const ref = itemDoc(id)
    if (!(await transaction.get(ref)).exists()) {
      transaction.set(ref, { ...newEntry(id, valid, []), taskId })
      return true
    }
    return false
  })
}

/**
 * Saves an edit. Only fields that differ from what the form opened with are written and pushed, so
 * a change the other person made meanwhile to another field is kept.
 */
const saveEdit = async ({ draft, id, message, opened }: { draft: ItemDraft, id: string, message: string, opened: ItemDraft }): Promise<void> => {
  const changed = changedFields(opened, draft)
  if (changed.length === 0) {
    return
  }
  const values = Object.fromEntries(changed.map(field => [field, draft[field]]))
  const written = updateDoc(itemDoc(id), {
    ...values, ...stamp(), dirty: arrayUnion(...changed), pendingOp: 'upsert', sync: 'pending', syncError: null,
  })
  logEvent(message, id, changedDetail(changed))
  return written
}

const statusAction = (status: Item['status']): string => {
  if (status === 'done') {
    return 'Marked done'
  }
  if (status === 'cancelled') {
    return 'Marked cancelled'
  }
  return 'Reopened'
}

const editAction = (opened: ItemDraft, draft: ItemDraft): string => draft.status === opened.status ? 'Edited' : statusAction(draft.status)

export const editItem = async (id: string, opened: ItemDraft, draft: ItemDraft): Promise<void> =>
  saveEdit({ draft: checkedDraft(draft), id, message: entryLogMessage(editAction(opened, draft), draft.title), opened })

/** Sets an entry's status (e.g. done after a swipe): only the status is written and pushed. */
export const setItemStatus = async (item: Item, status: Item['status']): Promise<void> => saveEdit({
  draft: { ...draftOf(item), status },
  id: item.id,
  message: entryLogMessage(statusAction(status), item.title),
  opened: draftOf(item),
})

/**
 * Saves an entry's extra dates. The outbox then brings their Google events in line (`planDates`),
 * without marking the entry pending: its own event doesn't change.
 */
export const setExtraDates = async (id: string, extraDates: EntryDate[]): Promise<void> =>
  updateDoc(itemDoc(id), { ...stamp(), extraDates })

/**
 * Marks an entry for deletion. Always through Google, even for an entry that looks unsynced: its
 * insert may have reached Google without the answer arriving. Deleting a missing event is harmless.
 */
export const removeItem = async (item: Pick<Item, 'id' | 'title'>): Promise<void> => {
  const written = updateDoc(itemDoc(item.id), { ...stamp(), pendingOp: 'delete', sync: 'pending', syncError: null })
  logEvent(entryLogMessage('Deleted', item.title), item.id)
  return written
}

export const retryItem = async (item: Item): Promise<void> =>
  updateDoc(itemDoc(item.id), { sync: 'pending', syncError: null })
