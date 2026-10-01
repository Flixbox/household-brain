import { collection, doc, onSnapshot, orderBy, query } from 'firebase/firestore'
import type { Category } from '../categories'
import type { HouseholdConfig } from '../calendar/setup'
import { auth, db } from '../firebase'
import { MEMBER_SCOPES, calendarToken, hasCalendarToken, loadGis } from '../google-token'
import type { Item } from './model'
import { type PushContext, pushItem } from './push'
import { itemsCollection, recordPush, recordPushError } from './store'
import { outboxApi } from './outbox-api'
import { isTransient } from './transient'

/**
 * The outbox: pushes pending entries to Google Calendar one at a time while a Calendar token is
 * available. Asking Google for a token needs a click, so the outbox never asks itself: without a
 * token, entries wait and the UI offers "Sync now" (`syncNow`). Network trouble, rate limits and
 * server errors leave entries pending and are retried with backoff and when the device comes back
 * online; only definite rejections are shown as errors. Lives outside React; components read
 * `useOutbox()`.
 */

export interface OutboxState {
  waiting: number
  failed: Item[]
  /** Entries wait for Google access, which needs a click ("Sync now"). */
  needsAccess: boolean
  /** Entries wait because the household calendar hasn't been created yet. */
  missingCalendar: boolean
}

const MIN_BACKOFF_MS = 5000
const MAX_BACKOFF_MS = 5 * 60_000

const fresh = () => ({
  categories: null as Category[] | null,
  config: null as HouseholdConfig | null,
  /** Whether the config snapshot has arrived; before that, a missing calendar is not yet known. */
  configLoaded: false,
  items: [] as Item[],
})
let data = fresh()
let state: OutboxState = { failed: [], missingCalendar: false, needsAccess: false, waiting: 0 }
let busy = false
let backoffMs = 0
let pausedUntil = 0
let timer: ReturnType<typeof setTimeout> | null = null
/** Revision last recorded per entry: a snapshot that still shows it is stale and must not be pushed again. */
const recorded = new Map<string, string>()
/** Entries whose latest local write the server hasn't confirmed yet. */
let unconfirmed = new Set<string>()
const listeners = new Set<() => void>()

function publish() {
  const pending = data.items.filter(item => item.sync === 'pending')
  state = {
    failed: data.items.filter(item => item.sync === 'error'),
    missingCalendar: pending.length > 0 && data.configLoaded && data.config === null,
    needsAccess: pending.length > 0 && !hasCalendarToken(MEMBER_SCOPES),
    waiting: pending.length,
  }
  for (const listener of listeners) {
    listener()
  }
}

function retryLater() {
  backoffMs = Math.min(Math.max(backoffMs * 2, MIN_BACKOFF_MS), MAX_BACKOFF_MS)
  pausedUntil = performance.now() + backoffMs
  timer = setTimeout(run, backoffMs)
}

async function pushOne(item: Item, context: Omit<PushContext, 'api'>): Promise<void> {
  try {
    if (await recordPush(item, await pushItem({ ...context, api: outboxApi }, item), context.uid)) {
      recorded.set(item.id, item.rev)
    }
    backoffMs = 0
  } catch (error) {
    if (isTransient(error)) {
      retryLater()
    } else {
      await recordPushError(item, error instanceof Error ? error.message : String(error))
    }
  }
}

function nextToPush(): Item | undefined {
  // Only entries the server already has: recording a push needs the server's copy, and offline
  // there is nothing to push anyway.
  return data.items.find(item => item.sync === 'pending' && !unconfirmed.has(item.id) && recorded.get(item.id) !== item.rev)
}

async function run(): Promise<void> {
  publish()
  const uid = auth.currentUser?.uid
  const next = nextToPush()
  const { categories, config } = data
  if (busy || !next || !uid || !config || !categories || performance.now() < pausedUntil || !hasCalendarToken(MEMBER_SCOPES)) {
    return
  }
  busy = true
  await pushOne(next, { categories, config, uid }).finally(() => {
    busy = false
  })
  await run()
}

const ignore = () => null

/** Starts watching for pending entries; returns the function that stops it. */
export function startOutbox(): () => void {
  // Load Google's script now, so the consent window opens instantly when Save or "Sync now" is clicked.
  loadGis().catch(ignore)
  const online = () => {
    pausedUntil = 0
    return run()
  }
  globalThis.addEventListener('online', online)
  const stops = [
    onSnapshot(query(itemsCollection, orderBy('updatedAt')), { includeMetadataChanges: true }, snapshot => {
      data.items = snapshot.docs.map(entry => entry.data() as Item)
      unconfirmed = new Set(snapshot.docs.filter(entry => entry.metadata.hasPendingWrites).map(entry => entry.id))
      return run()
    }, ignore),
    onSnapshot(query(collection(db, 'categories'), orderBy('sortOrder')), snapshot => {
      data.categories = snapshot.docs.map(entry => entry.data() as Category)
      return run()
    }, ignore),
    onSnapshot(doc(db, 'meta', 'config'), snapshot => {
      data.config = snapshot.exists() ? snapshot.data() as HouseholdConfig : null
      data.configLoaded = true
      return run()
    }, ignore),
  ]
  return () => {
    for (const stop of stops) {
      stop()
    }
    globalThis.removeEventListener('online', online)
    if (timer) {
      clearTimeout(timer)
    }
    data = fresh()
    recorded.clear()
    unconfirmed = new Set()
    publish()
  }
}

/**
 * Asks Google for Calendar access while a click is still fresh, so pushing can start right away.
 * Never awaited before saving: saving must not depend on Google.
 */
export function requestSyncAccess(): Promise<unknown> {
  return calendarToken(MEMBER_SCOPES, auth.currentUser?.email).then(() => {
    pausedUntil = 0
    return run()
  }, ignore)
}

/** "Sync now": gets Google access (call it from a click) and pushes everything waiting. */
export async function syncNow(): Promise<void> {
  await calendarToken(MEMBER_SCOPES, auth.currentUser?.email)
  pausedUntil = 0
  await run()
}

/** For `useOutbox`: subscribe to changes of the outbox state. */
export function subscribeOutbox(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export const outboxState = (): OutboxState => state
