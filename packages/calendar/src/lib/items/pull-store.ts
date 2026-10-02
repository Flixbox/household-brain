import { Timestamp, deleteField, doc, getDoc, getDocFromCache, getDocFromServer, getDocs, query, runTransaction, serverTimestamp, setDoc, updateDoc, where } from 'firebase/firestore'
import { db } from '@household-brain/firebase/firebase'
import type { CalendarEvent } from './event'
import type { Item } from './model'
import type { DateEventChange } from './date-pull'
import type { PullDecision } from './pull-plan'
import { newEventId } from './ids'
import { isDate } from './dates'
import { itemsCollection } from './store'
import { itemFrom } from '../documents'

const itemDoc = (id: string) => doc(db, 'items', id)
/** A pulled change is a new revision, but not a change by this person: `updatedBy` stays as it was. */
const pullStamp = () => ({ rev: newEventId(), updatedAt: serverTimestamp() })
const syncStateDoc = (uid: string) => doc(db, 'syncState', uid)

/** Applies the decision for one pulled event in a transaction, and returns it. */
export const applyPulled = (event: CalendarEvent, decide: (entry: Item | null) => PullDecision): Promise<PullDecision> =>
  runTransaction(db, async transaction => {
    const ref = itemDoc(event.id ?? '')
    const snapshot = await transaction.get(ref)
    const decision = decide(snapshot.exists() ? itemFrom(snapshot.id, snapshot.data()) : null)
    if (decision.kind === 'delete') {
      transaction.delete(ref)
    } else if (decision.kind === 'create') {
      transaction.set(ref, { ...decision.fields, ...pullStamp() })
    } else if (decision.kind === 'update' && (decision.normalise || Object.keys(decision.fields).length > 0)) {
      // Merging Google's values into an entry with unsent edits keeps its revision: those edits are
      // still the ones to push. Replacing an entry is a new revision.
      transaction.update(ref, decision.normalise ? { ...decision.fields, ...pullStamp() } : decision.fields)
    }
    return decision
  })

/** After the app adjusted an event: its etag and version, so the next pull sees it as our own. */
export const recordEtag = (id: string, uid: string, event: CalendarEvent): Promise<void> =>
  updateDoc(itemDoc(id), { [`etags.${uid}`]: event.etag ?? '', googleUpdated: event.updated ?? '' })

/**
 * A ledger value no event was ever written with, fresh each time: the outbox then writes the event
 * again. Clearing the entry instead would repeat a step (none → shape) the outbox may already have
 * taken this session, and it skips steps it has taken.
 */
const staleShape = () => ({ shape: `stale ${newEventId()}` })

/** Marks every date event of an entry stale, so the outbox writes them all again. */
const staleLedger = (entry: Item) => Object.fromEntries(Object.keys(entry.dateEvents ?? {}).map(dateId => [`dateEvents.${dateId}`, staleShape()]))

/**
 * After a full listing: removes synced entries whose event no longer exists in Google Calendar. Only
 * entries untouched since the listing began, re-checked in a transaction each, so an entry another
 * device created or someone edited meanwhile survives.
 */
export const removeVanished = async (eventIds: ReadonlySet<string>, listedSince: Timestamp, beforeDelete: (entry: Item) => Promise<void>): Promise<void> => {
  const untouched = (entry: { exists: () => boolean, get: (field: string) => unknown }) => {
    const updatedAt: unknown = entry.get('updatedAt')
    return entry.exists() && entry.get('sync') === 'synced' && updatedAt instanceof Timestamp && updatedAt.toMillis() < listedSince.toMillis()
  }
  const synced = await getDocs(query(itemsCollection, where('sync', '==', 'synced')))
  // The same check as the transaction's, so date events only go for entries about to go too.
  // An entry without a due date has no event, so it is never "vanished".
  const vanished = synced.docs.filter(entry => !eventIds.has(entry.id) && isDate(entry.get('dueDate')) && untouched(entry))
  // Their date events go first. A transient failure stops here, so the entries stay for the next full
  // listing; a refusal is reported by `beforeDelete` and the entries still go.
  await Promise.all(vanished.map(entry => beforeDelete(itemFrom(entry.id, entry.data()))))
  await Promise.all(vanished.map(entry => runTransaction(db, async transaction => {
    const latest = await transaction.get(entry.ref)
    if (untouched(latest)) {
      transaction.delete(entry.ref)
    } else if (latest.exists()) {
      // Kept after all (changed meanwhile): its date events, already deleted, are written again.
      transaction.update(entry.ref, staleLedger(itemFrom(latest.id, latest.data())))
    }
  })))
}

/** Each person's Google sync token: Google issues them per user. */
export const readSyncToken = async (uid: string): Promise<string | null> => {
  const snapshot = await getDoc(syncStateDoc(uid))
  const token: unknown = snapshot.get('syncToken')
  return typeof token === 'string' ? token : null
}

/** The server's clock, not this device's: written to syncState/{uid} and read back. */
export const serverNow = async (uid: string): Promise<Timestamp> => {
  await setDoc(syncStateDoc(uid), { listingStartedAt: serverTimestamp() }, { merge: true })
  const startedAt: unknown = (await getDocFromServer(syncStateDoc(uid))).get('listingStartedAt')
  if (!(startedAt instanceof Timestamp)) {
    throw new TypeError('The server did not return the listing time')
  }
  return startedAt
}

export const saveSyncToken = (uid: string, syncToken: string): Promise<void> =>
  setDoc(syncStateDoc(uid), { syncToken }, { merge: true })

/**
 * An extra date's event (one with `hb.entry`) never becomes an entry. An older app version that
 * didn't know them may have made one from it anyway, under the event's id: that stray is removed,
 * in Firestore only (nothing is pushed).
 */
export const dropStray = (eventId: string): Promise<void> =>
  runTransaction(db, async transaction => {
    const ref = itemDoc(eventId)
    if ((await transaction.get(ref)).exists()) {
      transaction.delete(ref)
    }
  })

/** An entry as the server has it now (a date event's owner must not be judged gone from a stale cache). */
export const readEntryFromServer = async (id: string): Promise<Item | null> => {
  const snapshot = await getDocFromServer(itemDoc(id))
  return snapshot.exists() ? itemFrom(snapshot.id, snapshot.data()) : null
}

/**
 * Applies what a date event changed in Google to its entry, in a transaction against the entry as it
 * is now (`dateEventChange`): a moved date is taken over, a deleted one dropped (both are changes to
 * the entry, so a new revision), and for anything else the ledger forgets the event, so the outbox
 * writes it back.
 */
export const applyDateChange = (entryId: string, dateId: string, decide: (entry: Item) => DateEventChange): Promise<void> =>
  runTransaction(db, async transaction => {
    const ref = itemDoc(entryId)
    const snapshot = await transaction.get(ref)
    if (!snapshot.exists()) {
      return
    }
    const entry = itemFrom(snapshot.id, snapshot.data())
    const fields = dateChangeFields(entry, dateId, decide(entry))
    if (fields) {
      transaction.update(ref, fields)
    }
  })

const dateChangeFields = (entry: Item, dateId: string, change: DateEventChange): Record<string, unknown> | null => {
  const dates = entry.extraDates ?? []
  switch (change.kind) {
    case 'adopt': {
      return { ...pullStamp(), extraDates: dates.map(entryDate => (entryDate.id === dateId ? { ...entryDate, date: change.date } : entryDate)) }
    }
    case 'remove': {
      return { ...pullStamp(), [`dateEvents.${dateId}`]: deleteField(), extraDates: dates.filter(entryDate => entryDate.id !== dateId) }
    }
    case 'rewrite': {
      return { [`dateEvents.${dateId}`]: staleShape() }
    }
    default: {
      return null
    }
  }
}

/**
 * After an entry's date events were deleted in Google but the entry stayed (edited here meanwhile):
 * they are written again.
 */
export const forgetDateEvents = (id: string): Promise<void> =>
  runTransaction(db, async transaction => {
    const snapshot = await transaction.get(itemDoc(id))
    const fields = snapshot.exists() ? staleLedger(itemFrom(snapshot.id, snapshot.data())) : {}
    if (Object.keys(fields).length > 0) {
      transaction.update(itemDoc(id), fields)
    }
  })

/** An entry from the local cache, or null when the cache doesn't have it (then ask the server). */
export const readEntryFromCache = async (id: string): Promise<Item | null> => {
  const snapshot = await getDocFromCache(itemDoc(id)).catch(() => null)
  return snapshot?.exists() ? itemFrom(snapshot.id, snapshot.data()) : null
}

/** Tells the other devices what this person's app handles (see APP_SCHEMA). */
export const markSchema = (uid: string, schema: number): Promise<void> =>
  setDoc(syncStateDoc(uid), { schema }, { merge: true })
