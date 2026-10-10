import { Timestamp, addDoc, collection, getDocs, limit, orderBy, query, serverTimestamp, where, writeBatch } from 'firebase/firestore'
import { useStore } from '@nanostores/react'
import { Temporal } from 'temporal-polyfill'
import { auth, db } from '@household-brain/firebase/firebase'
import { dataOf, queryStore } from '@household-brain/firebase/live'
import { type Log, logFrom } from '@household-brain/entries/lib/documents'
import { entryLogMessage } from '@household-brain/entries/lib/logs-messages'

const LOG_LIMIT = 200
const LOG_MESSAGE_LIMIT = 2000

const logsCollection = collection(db, 'logs')
const $logs = queryStore(query(logsCollection, orderBy('at', 'desc'), limit(LOG_LIMIT)), logFrom)

const writeLog = (kind: Log['kind'], message: string, itemId?: string): void => {
  const uid = auth.currentUser?.uid
  if (!uid) {
    return
  }
  const data = {
    at: serverTimestamp(),
    by: uid,
    kind,
    message: message.slice(0, LOG_MESSAGE_LIMIT),
    ...itemId ? { itemId } : {},
  }
  addDoc(logsCollection, data).catch(() => null)
}

export const logEvent = (message: string, itemId?: string): void => writeLog('event', message, itemId)

export const logError = (message: string, itemId?: string): void => writeLog('error', message, itemId)

/** An entry Google Calendar added, changed or removed, as a pull took it in. */
export const logGoogleChange = (action: string, title: string, itemId: string): void =>
  logEvent(`${entryLogMessage(action, title)} from Google Calendar`, itemId)

const pruneCutoff = (): Timestamp => Timestamp.fromMillis(Temporal.Now.instant().subtract({ days: 90 }).epochMilliseconds)

/** Removes old history in the background; a denied or offline cleanup is harmless. */
export const pruneOldLogs = (): void => {
  getDocs(query(logsCollection, where('at', '<', pruneCutoff()), limit(LOG_LIMIT)))
    .then(snapshot => {
      if (snapshot.empty) {
        return
      }
      const batch = writeBatch(db)
      snapshot.docs.forEach(entry => batch.delete(entry.ref))
      return batch.commit()
    })
    .catch(() => null)
}

export const useLogs = (): Log[] | null => dataOf(useStore($logs))
