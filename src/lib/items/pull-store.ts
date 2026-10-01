import { deleteDoc, doc, getDoc, getDocs, query, runTransaction, setDoc, updateDoc, where } from 'firebase/firestore'
import { db } from '../firebase'
import type { CalendarEvent } from './event'
import type { Item } from './model'
import type { PullDecision } from './pull-plan'
import { itemsCollection, stamp } from './store'

const itemDoc = (id: string) => doc(db, 'items', id)
const syncStateDoc = (uid: string) => doc(db, 'syncState', uid)

/** Applies the decision for one pulled event in a transaction, and returns it. */
export function applyPulled(event: CalendarEvent, decide: (entry: Item | null) => PullDecision): Promise<PullDecision> {
  return runTransaction(db, async transaction => {
    const ref = itemDoc(event.id ?? '')
    const snapshot = await transaction.get(ref)
    const decision = decide(snapshot.exists() ? snapshot.data() as Item : null)
    if (decision.kind === 'delete') {
      transaction.delete(ref)
    } else if (decision.kind === 'create') {
      transaction.set(ref, { ...decision.fields, ...stamp() })
    } else if (decision.kind === 'update') {
      // Merging Google's values into an entry with unsent edits keeps its revision: those edits are
      // still the ones to push. Replacing an entry is a new revision.
      transaction.update(ref, decision.normalise ? { ...decision.fields, ...stamp() } : decision.fields)
    }
    return decision
  })
}

export function recordEtag(id: string, uid: string, etag: string): Promise<void> {
  return updateDoc(itemDoc(id), { [`etags.${uid}`]: etag })
}

/** After a full listing: removes synced entries whose event no longer exists in Google Calendar. */
export async function removeVanished(eventIds: ReadonlySet<string>): Promise<void> {
  const synced = await getDocs(query(itemsCollection, where('sync', '==', 'synced')))
  await Promise.all(synced.docs.filter(entry => !eventIds.has(entry.id)).map(entry => deleteDoc(entry.ref)))
}

/** Each person's Google sync token: Google issues them per user. */
export async function readSyncToken(uid: string): Promise<string | null> {
  const snapshot = await getDoc(syncStateDoc(uid))
  return snapshot.exists() ? (snapshot.data() as { syncToken: string }).syncToken : null
}

export function saveSyncToken(uid: string, syncToken: string): Promise<void> {
  return setDoc(syncStateDoc(uid), { syncToken }, { merge: true })
}
