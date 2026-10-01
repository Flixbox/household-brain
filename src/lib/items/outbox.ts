import { collection, doc, onSnapshot, orderBy, query } from 'firebase/firestore'
import { useSyncExternalStore } from 'react'
import type { Category } from '../categories'
import { createCalendarApi } from '../calendar/api'
import type { HouseholdConfig } from '../calendar/setup'
import { auth, db } from '../firebase'
import { MEMBER_SCOPES, calendarToken, forgetCalendarToken, hasCalendarToken } from '../google-token'
import type { Item } from './model'
import { pushItem } from './push'
import { itemsCollection, recordPush, recordPushError } from './store'

/**
 * The outbox: pushes pending entries to Google Calendar one at a time, oldest first, while a
 * Calendar token is available. Without one it waits, because asking Google needs a click: the UI
 * offers "Sync now", which calls `syncNow`. Lives outside React; components read `useOutbox()`.
 */

export interface OutboxState {
  waiting: number
  failed: Item[]
  needsAccess: boolean
}

const api = createCalendarApi({
  forgetToken: forgetCalendarToken,
  token: () => calendarToken(MEMBER_SCOPES, auth.currentUser?.email),
})

const data = { categories: [] as Category[], config: null as HouseholdConfig | null, items: [] as Item[] }
let state: OutboxState = { failed: [], needsAccess: false, waiting: 0 }
let busy = false
const listeners = new Set<() => void>()

function publish() {
  const waiting = data.items.filter(item => item.sync === 'pending').length
  state = {
    failed: data.items.filter(item => item.sync === 'error'),
    needsAccess: waiting > 0 && !hasCalendarToken(MEMBER_SCOPES),
    waiting,
  }
  for (const listener of listeners) {
    listener()
  }
}

const describe = (error: unknown) => (error instanceof Error ? error.message : String(error))

async function pushOne(item: Item, uid: string, config: HouseholdConfig): Promise<void> {
  try {
    await recordPush(item, await pushItem({ api, categories: data.categories, config, uid }, item), uid)
  } catch (error) {
    await recordPushError(item, describe(error))
  }
}

async function run(): Promise<void> {
  publish()
  const uid = auth.currentUser?.uid
  const next = data.items.find(item => item.sync === 'pending')
  if (busy || !next || !uid || !data.config || !hasCalendarToken(MEMBER_SCOPES)) {
    return
  }
  busy = true
  await pushOne(next, uid, data.config).finally(() => {
    busy = false
  })
  await run()
}

/** Starts watching for pending entries; returns the function that stops it. */
export function startOutbox(): () => void {
  const stops = [
    onSnapshot(query(itemsCollection, orderBy('updatedAt')), snapshot => {
      data.items = snapshot.docs.map(entry => entry.data() as Item)
      return run()
    }),
    onSnapshot(query(collection(db, 'categories'), orderBy('sortOrder')), snapshot => {
      data.categories = snapshot.docs.map(entry => entry.data() as Category)
    }),
    onSnapshot(doc(db, 'meta', 'config'), snapshot => {
      data.config = snapshot.exists() ? snapshot.data() as HouseholdConfig : null
      return run()
    }),
  ]
  return () => {
    for (const stop of stops) {
      stop()
    }
  }
}

/** Gets Google access (call it from a click) and pushes everything waiting. */
export async function syncNow(): Promise<void> {
  await calendarToken(MEMBER_SCOPES, auth.currentUser?.email)
  await run()
}

/**
 * Asks Google for Calendar access while a click is still fresh (saving an entry), so the push can run
 * right away. Saving never depends on it: without access the entry waits for "Sync now".
 */
export async function requestSyncAccess(): Promise<void> {
  await calendarToken(MEMBER_SCOPES, auth.currentUser?.email).catch(() => null)
}

const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useOutbox(): OutboxState {
  return useSyncExternalStore(subscribe, () => state)
}
