import { Timestamp, addDoc, collection, getDocs, limit, orderBy, query, serverTimestamp, where, writeBatch } from 'firebase/firestore'
import { useStore } from '@nanostores/react'
import { Temporal } from 'temporal-polyfill'
import { auth, db } from '@household-brain/firebase/firebase'
import { dataOf, queryStore } from '@household-brain/firebase/live'
import { type Log, logFrom } from '@household-brain/entries/lib/documents'
import { changedDetail, entryLogMessage, logDetail } from '@household-brain/entries/lib/logs-messages'

const LOG_LIMIT = 200
const LOG_MESSAGE_LIMIT = 2000

const logsCollection = collection(db, 'logs')
const $logs = queryStore(query(logsCollection, orderBy('at', 'desc'), limit(LOG_LIMIT)), logFrom)

const writeLog = (kind: Log['kind'], { message, itemId, detail }: { message: string, itemId?: string | undefined, detail?: string | undefined }): void => {
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
    ...detail ? { detail: logDetail(detail) } : {},
  }
  addDoc(logsCollection, data).catch(() => null)
}

/** `detail` is what the row shows when opened: which fields changed, what Google answered. */
export const logEvent = (message: string, itemId?: string, detail?: string): void => writeLog('event', { detail, itemId, message })

export const logError = (message: string, itemId?: string, detail?: string): void => writeLog('error', { detail, itemId, message })

const failing = new Set<string>()

/**
 * An error that keeps happening (Google down, an API switched off) is logged once, when it starts,
 * not on every retry; once `logRecovered` says it works again, the next failure is logged anew.
 */
export const logErrorOnce = (key: string, message: string, detail?: string): void => {
  if (!failing.has(key)) {
    failing.add(key)
    logError(message, '', detail)
  }
}

export const logRecovered = (key: string): void => {
  failing.delete(key)
}

/** An entry Google Calendar added, changed or removed, as a pull took it in. */
export const logGoogleChange = (action: string, title: string, { itemId, changed = [] }: { itemId: string, changed?: readonly string[] }): void =>
  logEvent(`${entryLogMessage(action, title)} from Google Calendar`, itemId, changedDetail(changed))

// An Instant has no calendar, so the 90 days are counted in hours.
const pruneCutoff = (): Timestamp => Timestamp.fromMillis(Temporal.Now.instant().subtract({ hours: 24 * 90 }).epochMilliseconds)

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
