/**
 * One writer, few retries (#402, A7 of #357). A watcher's writes to GitHub (resolving a thread, marking
 * a draft ready, dismissing a review, `@bot resolve`, `@bot review`, taking `question` off) come only from an all-events watcher; a
 * subscribed one leaves them to it. Until the shared poller (A2) exists, that is what keeps a dozen
 * watchers from each making the same write.
 *
 * A failed write waits 1, 2, 5 and then every 10 minutes before the next try, instead of being tried
 * on every look; the count is shared by this machine's watchers of the repository.
 *
 * A subscribed agent still hears how each write went: the writer leaves each event in a shared folder,
 * and a subscribed watcher reports the ones for its PR, once each. No call to GitHub; a watcher that
 * starts later doesn't hear what was written over an hour before.
 *
 * With no all-events watcher those writes wait unseen, so the writer marks each look and a subscribed
 * watcher says once when none has come for a while (#432).
 */
import { REPO_DIR, addLine, subscriptions } from './watch-state'
import { filesIn, removeOlder, unclaim, writeWhole } from './watch-files'
import { allSettled, ignoreFailure, textOf } from './read'
import { type Event, clockTime } from './watch-events'
import { record } from './watch-text'
import { queue, report } from './watch-output'
import { retryDelayMs } from './watch-write-retry'

const RETRIES_DIR = `${REPO_DIR}/write-retries`
const OUTCOMES_DIR = `${REPO_DIR}/write-outcomes`
const OUTCOME_LIFE = Temporal.Duration.from({ hours: 1 })
const WRITER_SEEN = `${REPO_DIR}/writer-seen`
/** Must stay above the writer's longest pause between looks (paced, #407), and a restart: a live writer never counts as gone. */
const WRITER_GONE_AFTER_MS = Temporal.Duration.from({ minutes: 30 }).total('milliseconds')
const STARTED_AT = Temporal.Now.instant().epochMilliseconds

// Only room: a retry forgotten after a day is simply due.
await removeOlder(RETRIES_DIR, Temporal.Duration.from({ hours: 24 }))
await removeOlder(OUTCOMES_DIR, OUTCOME_LIFE)

/** Whether this watcher makes the writes: an all-events one. */
export const IS_WRITER = !subscriptions.scoped

const hashed = (text: string) => Bun.hash(text).toString(36)

const failuresIn = async (path: string): Promise<number> => Number(await Bun.file(path).text().catch(() => '0'))

/** Whether the write at `path` still waits. A write that never failed doesn't: a missing file has no real time. */
const isWaiting = (path: string, failures: number): boolean =>
  failures > 0 && Temporal.Now.instant().epochMilliseconds - Bun.file(path).lastModified < retryDelayMs(failures)

/**
 * Runs `write` when this watcher is the writer and the write's wait is over, and keeps count of its
 * failures (`false`). Null when it didn't run; otherwise what `write` answered (its own null means
 * nothing was attempted, and doesn't count).
 */
export const attemptWrite = async (key: string, write: () => Promise<boolean | null>): Promise<boolean | null> => {
  const path = `${RETRIES_DIR}/${hashed(key)}`
  const failures = await failuresIn(path)
  if (!IS_WRITER || isWaiting(path, failures)) {
    return null
  }
  const result = await write()
  await (result === false ? writeWhole(path, String(failures + 1)) : unclaim(path)).catch(ignoreFailure)
  return result
}

/** Reports what a write came to, and (unless `shared` is off) leaves it for the subscribed watchers. */
export const reportWrite = async (event: Event | null, pr: number, shared = true): Promise<void> => {
  await report(event, pr)
  await (IS_WRITER && shared && event ? writeWhole(`${OUTCOMES_DIR}/pr-${pr}/${hashed(event.key)}`, JSON.stringify(event)).catch(ignoreFailure) : Promise.resolve())
}

const eventFrom = (text: string): Event | null => {
  try {
    const { key, lines, quiet } = record(JSON.parse(text))
    return typeof key === 'string' && Array.isArray(lines) ? { key, lines: lines.map((line: unknown) => textOf(line)), quiet: quiet === true } : null
  } catch {
    return null
  }
}

/** For a subscribed watcher: reports what the writer did on PR `pr` within the last hour, oldest first. */
export const relayWrites = async (pr: number): Promise<void> => {
  if (IS_WRITER) {
    return
  }
  const since = Temporal.Now.instant().subtract(OUTCOME_LIFE).epochMilliseconds
  const files = await filesIn(`${OUTCOMES_DIR}/pr-${pr}`)
  const fresh = files.filter(file => file.changed >= since).toSorted((one, other) => one.changed - other.changed)
  await allSettled(fresh.map(async file => report(eventFrom(file.text), pr)))
}

const writerSeenAt = async (): Promise<number | null> => {
  const file = Bun.file(WRITER_SEEN)
  return (await file.exists()) ? file.lastModified : null
}

const noWriterLine = (seen: number | null): string => {
  const since = seen === null ? 'yet' : `since ${clockTime(Temporal.Instant.fromEpochMilliseconds(seen)) ?? '?'}`
  return `NO_WRITER: no all-events watcher has looked at this repository on this machine ${since}, so \`Resolved:\` replies stay unresolved and approved drafts stay drafts until one runs`
}

/**
 * The writer marks that it looked; a subscribed watcher reports once per absence (the key is the last
 * mark) when neither that mark nor its own start (`started`, in epoch milliseconds) is recent.
 */
export const checkWriter = async (started = STARTED_AT): Promise<void> => {
  if (IS_WRITER) {
    await writeWhole(WRITER_SEEN, 'seen').catch(ignoreFailure)
    return
  }
  const seen = await writerSeenAt()
  const fresh = Temporal.Now.instant().epochMilliseconds - Math.max(seen ?? 0, started) < WRITER_GONE_AFTER_MS
  if (!fresh && await addLine('reported', `no-writer ${seen ?? 'never'}`)) {
    queue([noWriterLine(seen)], { system: true })
  }
}
