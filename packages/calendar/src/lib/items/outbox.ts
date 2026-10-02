import { auth } from '@household-brain/firebase/firebase'
import { MEMBER_SCOPES, calendarToken, hasCalendarToken, loadGis } from '../google-token'
import type { Item } from './model'
import { type PushContext, pushItem } from './push'
import { pullChanges } from './puller'
import { recordPush, recordPushError } from './store'
import { outboxApi } from './outbox-api'
import { isTransient } from './transient'
import { $outbox } from './outbox-state'
import { watchOutboxTriggers } from './outbox-triggers'
import { forgetDateWork, nextDateWork, runDateWork } from './date-outbox'

/**
 * The outbox: pushes pending entries to Google Calendar one at a time while a Calendar token is
 * available. Asking Google for a token needs a click, so the outbox never asks itself: without a
 * token, entries wait and the UI offers "Sync now" (`syncNow`). Network trouble, rate limits and
 * server errors leave entries pending and are retried with backoff and when the device comes back
 * online; only definite rejections are shown as errors. Lives outside React; it publishes its state
 * to `$outbox`, which components read with `useOutbox()`.
 */

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
let busy = false
let backoffMs = 0
let pausedUntil = 0
let timer: ReturnType<typeof setTimeout> | null = null
/** Revision last recorded per entry: a snapshot that still shows it is stale and must not be pushed again. */
const recorded = new Map<string, string>()
/** Entries whose latest local write the server hasn't confirmed yet. */
let unconfirmed = new Set<string>()
// How long a finished pull is reused instead of pulling again. Shorter in the emulator (e2e) build, so
// the tests don't wait on it; compared inline so production builds drop the branch.
const PULL_REUSE_MS = import.meta.env.VITE_USE_EMULATORS === 'true' ? 200 : 3000
let pulling: Promise<void> | null = null
let pulledAt = Number.NEGATIVE_INFINITY
let pullProblem: string | null = null
let pullRequested = false
/**
 * Bumped by `reset`. A run still in flight for the previous account checks it after every wait, and
 * then leaves the outbox's state (busy, pull, problem, retries) to the next one.
 */
let generation = 0
const describe = (error: unknown) => (error instanceof Error ? error.message : String(error))

const publish = () => {
  const pending = data.items.filter(item => item.sync === 'pending')
  $outbox.set({
    failed: data.items.filter(item => item.sync === 'error'),
    missingCalendar: pending.length > 0 && data.configLoaded && data.config === null,
    // Without a token this device neither pushes nor pulls, so it is offered whenever a calendar exists.
    needsAccess: data.config !== null && !hasCalendarToken(MEMBER_SCOPES, auth.currentUser?.email),
    pullProblem,
    waiting: pending.length,
  })
}

const retryLater = (started: number) => {
  if (started !== generation) {
    return
  }
  backoffMs = Math.min(Math.max(backoffMs * 2, MIN_BACKOFF_MS), MAX_BACKOFF_MS)
  pausedUntil = performance.now() + backoffMs
  timer = setTimeout(run, backoffMs)
}

const pushOne = async (item: Item, context: PushContext, started: number): Promise<void> => {
  try {
    const outcome = await pushItem(context, item)
    if (await recordPush(item, outcome, { categories: context.categories, uid: context.uid })) {
      recorded.set(item.id, item.rev)
    }
    backoffMs = 0
  } catch (error) {
    if (isTransient(error)) {
      retryLater(started)
    } else {
      await recordPushError(item, describe(error))
    }
  }
}

/** The next extra date's event to write (`date-outbox.ts`), for entries whose own event is in Google. */
const nextDate = (context: PushContext | null) =>
  context && nextDateWork(data.items, context, item => item.sync === 'synced' && !unconfirmed.has(item.id))

const nextToPush = (): Item | undefined =>
  // Only entries the server already has: recording a push needs the server's copy, and offline
  // there is nothing to push anyway.
  data.items.find(item => item.sync === 'pending' && !unconfirmed.has(item.id) && recorded.get(item.id) !== item.rev)

/** Everything a pull or push needs, or null while something is still missing. */
const readyContext = (): PushContext | null => {
  const uid = auth.currentUser?.uid
  const { categories, config } = data
  if (!uid || !config || !categories || performance.now() < pausedUntil || !hasCalendarToken(MEMBER_SCOPES, auth.currentUser?.email)) {
    return null
  }
  return { api: outboxApi, categories, config, uid }
}

/** Pulls from Google Calendar, at most once per few seconds; parallel callers share one pull. */
const pullNow = (context: PushContext): Promise<void> => {
  if (performance.now() - pulledAt < PULL_REUSE_MS) {
    return Promise.resolve()
  }
  const started = generation
  pulling ??= pullChanges(context)
    .then(problems => {
      if (started === generation) {
        pullProblem = problems.length > 0 ? problems.join(' · ') : null
      }
    }, (error: unknown) => {
      if (started === generation) {
        pullProblem = isTransient(error) ? pullProblem : describe(error)
      }
    })
    .finally(() => {
      if (started === generation) {
        pulling = null
        pulledAt = performance.now()
      }
    })
  return pulling
}

/** Pushes the next pending entry, or else writes the next date event. */
const pushNext = async (context: PushContext, started: number): Promise<void> => {
  const next = nextToPush()
  const date = next ? null : nextDate(context)
  if (next) {
    await pushOne(next, context, started)
  } else if (date) {
    await runDateWork(context, date).then(() => { backoffMs = 0 }, () => retryLater(started))
  }
}

/**
 * One step: pull (always when `alwaysPull`, otherwise only before a push, so a write is based on
 * Google's latest), then push the next pending entry, and repeat while entries wait.
 */
const step = async (context: PushContext): Promise<boolean> => {
  const started = generation
  busy = true
  try {
    await pullNow(context)
    if (started === generation) {
      await pushNext(context, started)
    }
  } finally {
    if (started === generation) {
      busy = false
    }
  }
  // False once a sign-out came in between: this run's account is gone, so it stops here.
  return started === generation
}

const run = async (alwaysPull = false): Promise<void> => {
  publish()
  if (busy) {
    // A pull asked for during a push (Sync now, foreground, timer) runs right after it.
    pullRequested ||= alwaysPull
    return
  }
  const context = readyContext()
  if (!context || (!alwaysPull && !nextToPush() && !nextDate(context))) {
    return
  }
  if (await step(context)) {
    await continueAfterStep()
  }
}

/** Runs the next step if entries still wait, or if a pull was asked for while this one was busy. */
const continueAfterStep = async (): Promise<void> => {
  publish()
  const again = pullRequested
  pullRequested = false
  if (again) {
    // The pull that just ran started before the request: don't let its reuse window swallow it.
    pulledAt = Number.NEGATIVE_INFINITY
  }
  if (again || nextToPush() || nextDate(readyContext())) {
    await run(again)
  }
}

const ignore = () => null

const watch = (): (() => void)[] =>
  watchOutboxTriggers({
    categories: categories => {
      data.categories = categories
      return run()
    },
    config: config => {
      data.config = config
      data.configLoaded = true
      return run(true)
    },
    dateGate: () => run(),
    items: (items, pendingWrites) => {
      data.items = items
      unconfirmed = pendingWrites
      return run()
    },
    online: () => {
      pausedUntil = 0
      return run()
    },
    pull: () => run(true),
    tokenChanged: () => run(),
  })

/** Forgets retries and pulls: the waiting, the last pull and its problem. */
const forgetTiming = () => {
  if (timer) {
    clearTimeout(timer)
  }
  timer = null
  busy = false
  pulling = null
  backoffMs = 0
  pausedUntil = 0
  pulledAt = Number.NEGATIVE_INFINITY
  pullProblem = null
  pullRequested = false
}

/** Back to a clean start (sign-out): nothing of the previous account's sync state carries over. */
const reset = () => {
  forgetTiming()
  generation += 1
  data = fresh()
  recorded.clear()
  forgetDateWork()
  unconfirmed = new Set()
  publish()
}

/** Starts watching for pending entries; returns the function that stops it. */
export const startOutbox = (): () => void => {
  // Load Google's script now, so the consent window opens instantly when Save or "Sync now" is clicked.
  loadGis().catch(ignore)
  const stops = [...watch(), reset]
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
export const requestSyncAccess = (): Promise<unknown> =>
  calendarToken(MEMBER_SCOPES, auth.currentUser?.email).then(() => {
    pausedUntil = 0
    return run(true)
  }, ignore)

/** "Sync now": gets Google access (call it from a click) and pushes everything waiting. */
export const syncNow = async (): Promise<void> => {
  await calendarToken(MEMBER_SCOPES, auth.currentUser?.email)
  pausedUntil = 0
  pulledAt = Number.NEGATIVE_INFINITY
  await run(true)
}

/**
 * Pulls from Google Calendar now, ignoring the reuse window, so an entry opened for editing catches
 * up with Google; what the pull brings arrives through the entries listener like any other change.
 * Nothing happens offline or without Google access; while a push runs, the pull runs right after it.
 */
export const refreshNow = (): Promise<void> => {
  if (!navigator.onLine || !hasCalendarToken(MEMBER_SCOPES, auth.currentUser?.email)) {
    return Promise.resolve()
  }
  pulledAt = Number.NEGATIVE_INFINITY
  return run(true)
}
