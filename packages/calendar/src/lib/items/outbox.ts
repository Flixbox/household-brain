import { collection, doc, onSnapshot, orderBy, query } from 'firebase/firestore'
import { auth, db } from '@household-brain/firebase'
import { MEMBER_SCOPES, calendarToken, hasCalendarToken, loadGis } from '../google-token'
import type { Item } from './model'
import { type PushContext, pushItem } from './push'
import { pullChanges } from './puller'
import { draftFrom } from './from-event'
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
  /** Why the last pull from Google Calendar failed, unless that clears by itself. */
  pullProblem: string | null
}

const MIN_BACKOFF_MS = 5000
const MAX_BACKOFF_MS = 5 * 60_000

const fresh = () => ({
  categories: null as PushContext['categories'] | null,
  config: null as PushContext['config'] | null,
  /** Whether the config snapshot has arrived; before that, a missing calendar is not yet known. */
  configLoaded: false,
  items: [] as Item[],
})
let data = fresh()
let state: OutboxState = { failed: [], missingCalendar: false, needsAccess: false, pullProblem: null, waiting: 0 }
let busy = false
let backoffMs = 0
let pausedUntil = 0
let timer: ReturnType<typeof setTimeout> | null = null
/** Revision last recorded per entry: a snapshot that still shows it is stale and must not be pushed again. */
const recorded = new Map<string, string>()
/** Entries whose latest local write the server hasn't confirmed yet. */
let unconfirmed = new Set<string>()
const listeners = new Set<() => void>()
const PULL_REUSE_MS = 3000
const PULL_EVERY_MS = 60_000
let pulling: Promise<void> | null = null
let pulledAt = Number.NEGATIVE_INFINITY
let pullProblem: string | null = null
let pullRequested = false
const describe = (error: unknown) => (error instanceof Error ? error.message : String(error))

function publish() {
  const pending = data.items.filter(item => item.sync === 'pending')
  state = {
    failed: data.items.filter(item => item.sync === 'error'),
    missingCalendar: pending.length > 0 && data.configLoaded && data.config === null,
    // Without a token this device neither pushes nor pulls, so it is offered whenever a calendar exists.
    needsAccess: data.config !== null && !hasCalendarToken(MEMBER_SCOPES),
    pullProblem,
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

async function pushOne(item: Item, context: PushContext): Promise<void> {
  try {
    const outcome = await pushItem(context, item)
    const remote = outcome.kind === 'synced' ? draftFrom(outcome.event, context.categories) : null
    if (await recordPush(item, outcome, { remote, uid: context.uid })) {
      recorded.set(item.id, item.rev)
    }
    backoffMs = 0
  } catch (error) {
    if (isTransient(error)) {
      retryLater()
    } else {
      await recordPushError(item, describe(error))
    }
  }
}

function nextToPush(): Item | undefined {
  // Only entries the server already has: recording a push needs the server's copy, and offline
  // there is nothing to push anyway.
  return data.items.find(item => item.sync === 'pending' && !unconfirmed.has(item.id) && recorded.get(item.id) !== item.rev)
}

/** Everything a pull or push needs, or null while something is still missing. */
function readyContext(): PushContext | null {
  const uid = auth.currentUser?.uid
  const { categories, config } = data
  if (!uid || !config || !categories || performance.now() < pausedUntil || !hasCalendarToken(MEMBER_SCOPES)) {
    return null
  }
  return { api: outboxApi, categories, config, uid }
}

/** Pulls from Google Calendar, at most once per few seconds; parallel callers share one pull. */
function pullNow(context: PushContext): Promise<void> {
  if (performance.now() - pulledAt < PULL_REUSE_MS) {
    return Promise.resolve()
  }
  pulling ??= pullChanges(context)
    .then(problems => {
      pullProblem = problems.length > 0 ? problems.join(' · ') : null
    }, (error: unknown) => {
      pullProblem = isTransient(error) ? pullProblem : describe(error)
    })
    .finally(() => {
      pulling = null
      pulledAt = performance.now()
    })
  return pulling
}

/**
 * One step: pull (always when `alwaysPull`, otherwise only before a push, so a write is based on
 * Google's latest), then push the next pending entry, and repeat while entries wait.
 */
async function step(context: PushContext): Promise<void> {
  busy = true
  try {
    await pullNow(context)
    const next = nextToPush()
    if (next) {
      await pushOne(next, context)
    }
  } finally {
    busy = false
  }
}

async function run(alwaysPull = false): Promise<void> {
  publish()
  if (busy) {
    // A pull asked for during a push (Sync now, foreground, timer) runs right after it.
    pullRequested ||= alwaysPull
    return
  }
  const context = readyContext()
  if (!context || (!alwaysPull && !nextToPush())) {
    return
  }
  await step(context)
  await continueAfterStep()
}

/** Runs the next step if entries still wait, or if a pull was asked for while this one was busy. */
async function continueAfterStep(): Promise<void> {
  publish()
  const again = pullRequested
  pullRequested = false
  if (again) {
    // The pull that just ran started before the request: don't let its reuse window swallow it.
    pulledAt = Number.NEGATIVE_INFINITY
  }
  if (again || nextToPush()) {
    await run(again)
  }
}

const ignore = () => null

function watchFirestore(): (() => void)[] {
  return [
    onSnapshot(query(itemsCollection, orderBy('updatedAt')), { includeMetadataChanges: true }, snapshot => {
      data.items = snapshot.docs.map(entry => entry.data() as Item)
      unconfirmed = new Set(snapshot.docs.filter(entry => entry.metadata.hasPendingWrites).map(entry => entry.id))
      return run()
    }, ignore),
    onSnapshot(query(collection(db, 'categories'), orderBy('sortOrder')), snapshot => {
      data.categories = snapshot.docs.map(entry => entry.data() as PushContext['categories'][number])
      return run()
    }, ignore),
    onSnapshot(doc(db, 'meta', 'config'), snapshot => {
      data.config = snapshot.exists() ? snapshot.data() as PushContext['config'] : null
      data.configLoaded = true
      return run(true)
    }, ignore),
  ]
}

function watchDevice(): (() => void)[] {
  const online = () => {
    pausedUntil = 0
    return run()
  }
  // Changes made directly in Google Calendar: picked up once a minute and whenever the app comes back
  // to the foreground, while it is visible (README section 5.3).
  const pullIfVisible = () => (document.visibilityState === 'visible' ? run(true) : Promise.resolve())
  globalThis.addEventListener('online', online)
  document.addEventListener('visibilitychange', pullIfVisible)
  const every = setInterval(pullIfVisible, PULL_EVERY_MS)
  return [
    () => globalThis.removeEventListener('online', online),
    () => document.removeEventListener('visibilitychange', pullIfVisible),
    () => clearInterval(every),
  ]
}

function reset() {
  if (timer) {
    clearTimeout(timer)
  }
  data = fresh()
  recorded.clear()
  unconfirmed = new Set()
  publish()
}

/** Starts watching for pending entries; returns the function that stops it. */
export function startOutbox(): () => void {
  // Load Google's script now, so the consent window opens instantly when Save or "Sync now" is clicked.
  loadGis().catch(ignore)
  const stops = [...watchFirestore(), ...watchDevice(), reset]
  return () => {
    for (const stop of stops) {
      stop()
    }
  }
}

/**
 * Asks Google for Calendar access while a click is still fresh, so pushing can start right away.
 * Never awaited before saving: saving must not depend on Google.
 */
export function requestSyncAccess(): Promise<unknown> {
  return calendarToken(MEMBER_SCOPES, auth.currentUser?.email).then(() => {
    pausedUntil = 0
    return run(true)
  }, ignore)
}

/** "Sync now": gets Google access (call it from a click) and pushes everything waiting. */
export async function syncNow(): Promise<void> {
  await calendarToken(MEMBER_SCOPES, auth.currentUser?.email)
  pausedUntil = 0
  pulledAt = Number.NEGATIVE_INFINITY
  await run(true)
}

/** For `useOutbox`: subscribe to changes of the outbox state. */
export function subscribeOutbox(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export const outboxState = (): OutboxState => state
