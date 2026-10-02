import { type Timestamp, doc, getDoc, getDocFromServer, getDocs, query, runTransaction, serverTimestamp, setDoc, updateDoc, where } from 'firebase/firestore'
import { db } from '@household-brain/firebase/firebase'
import type { CalendarEvent } from './event'
import type { Item } from './model'
import type { PullDecision } from './pull-plan'
import { newEventId } from './ids'
import { itemsCollection } from './store'

const itemDoc = (id: string) => doc(db, 'items', id)
/** A pulled change is a new revision, but not a change by this person: `updatedBy` stays as it was. */
const pullStamp = () => ({ rev: newEventId(), updatedAt: serverTimestamp() })
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
      transaction.set(ref, { ...decision.fields, ...pullStamp() })
    } else if (decision.kind === 'update') {
      // Merging Google's values into an entry with unsent edits keeps its revision: those edits are
      // still the ones to push. Replacing an entry is a new revision.
      transaction.update(ref, decision.normalise ? { ...decision.fields, ...pullStamp() } : decision.fields)
    }
    return decision
  })
}

/** After the app adjusted an event: its etag and version, so the next pull sees it as our own. */
export function recordEtag(id: string, uid: string, event: CalendarEvent): Promise<void> {
  return updateDoc(itemDoc(id), { [`etags.${uid}`]: event.etag ?? '', googleUpdated: event.updated ?? '' })
}

/**
 * After a full listing: removes synced entries whose event no longer exists in Google Calendar. Only
 * entries untouched since the listing began, re-checked in a transaction each, so an entry another
 * device created or someone edited meanwhile survives.
 */
export async function removeVanished(eventIds: ReadonlySet<string>, listedSince: Timestamp): Promise<void> {
  const synced = await getDocs(query(itemsCollection, where('sync', '==', 'synced')))
  await Promise.all(synced.docs.filter(entry => !eventIds.has(entry.id)).map(entry => runTransaction(db, async transaction => {
    const latest = await transaction.get(entry.ref)
    const updatedAt = latest.get('updatedAt') as Timestamp | null
    if (latest.exists() && latest.get('sync') === 'synced' && updatedAt && updatedAt.toMillis() < listedSince.toMillis()) {
      transaction.delete(entry.ref)
    }
  })))
}

/** Each person's Google sync token: Google issues them per user. */
export async function readSyncToken(uid: string): Promise<string | null> {
  const snapshot = await getDoc(syncStateDoc(uid))
  return snapshot.exists() ? (snapshot.data() as { syncToken: string }).syncToken : null
}

/** The server's clock, not this device's: written to syncState/{uid} and read back. */
export async function serverNow(uid: string): Promise<Timestamp> {
  await setDoc(syncStateDoc(uid), { listingStartedAt: serverTimestamp() }, { merge: true })
  return (await getDocFromServer(syncStateDoc(uid))).get('listingStartedAt') as Timestamp
}

export function saveSyncToken(uid: string, syncToken: string): Promise<void> {
  return setDoc(syncStateDoc(uid), { syncToken }, { merge: true })
}

/**
 * An extra date's event (one with `hb.entry`) never becomes an entry. An older app version that
 * didn't know them may have made one from it anyway, under the event's id: that stray is removed,
 * in Firestore only (nothing is pushed).
 */
export function dropStray(eventId: string): Promise<void> {
  return runTransaction(db, async transaction => {
    const ref = itemDoc(eventId)
    if ((await transaction.get(ref)).exists()) {
      transaction.delete(ref)
    }
  })
}

/** Tells the other devices this person's app recognises date events (see DATE_EVENTS_SCHEMA). */
export function markSchema(uid: string, schema: number): Promise<void> {
  return setDoc(syncStateDoc(uid), { schema }, { merge: true })
}
