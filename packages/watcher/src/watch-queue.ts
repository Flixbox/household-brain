/**
 * The project watcher's look at the merge queue (watch-project.ts, #251): who entered it, who fell off,
 * and who should be in it but never joined (#305).
 */
import { MERGE_QUEUE, type PrState, dequeueReason, prStates, queueEntries } from './watch-github'
import { type QueueEntry, dequeuedEvent, notQueuedEvent, queueChanges, queueLine, queuedEvent, unqueuedLines } from './watch-queue-events'
import { exists, readLines, updateLines, writeLines } from './watch-state'
import { GH } from './watch-gh'
import { report } from './watch-output'

/** A PR that left the queue: nothing to say when it merged; still open, it fell off. */
const checkLeft = async (lines: string[]): Promise<void> => {
  const left = lines.map(line => ({ enqueuedAt: line.split(' ')[1] ?? '', line, pr: Number(line.split(' ')[0]) }))
  const states = await prStates(left.map(({ pr }) => pr)).catch(() => null)
  // A state that couldn't be read keeps the PR on the list: the next look asks again.
  const known = left.filter(({ pr }) => states?.has(pr) === true)
  await Promise.all(known.filter(({ pr }) => states?.get(pr)?.state === 'OPEN').map(async ({ enqueuedAt, pr }) =>
    report(dequeuedEvent(pr, enqueuedAt, await dequeueReason(pr).catch(() => '')), pr)))
  const settled = new Set(known.map(({ line }) => line))
  await updateLines('queued', current => current.filter(line => !settled.has(line)))
}

/** The PRs that entered the queue since the last look, and the ones that left it. */
const checkChanges = async (entries: Map<number, QueueEntry>, now: string[]): Promise<void> => {
  const { entered, left } = queueChanges(await readLines('queued'), now)
  await Promise.all([...entries].filter(([pr, entry]) => entered.includes(queueLine(pr, entry)))
    .map(async ([pr, entry]) => report(queuedEvent(pr, entry), pr)))
  await updateLines('queued', current => [...new Set([...current, ...now])])
  await (left.length > 0 ? checkLeft(left) : Promise.resolve())
}

export const checkQueue = async (): Promise<void> => {
  // A queue that can't be read is asked again next look; the PRs on the list stay on it meanwhile.
  const entries = await queueEntries().catch(() => null)
  if (!entries) {
    return
  }
  const now = [...entries].map(([pr, entry]) => queueLine(pr, entry))
  // On the first look, the PRs already queued aren't news.
  await (await exists('queued') ? checkChanges(entries, now) : writeLines('queued', now))
}

/**
 * A PR that should be in the merge queue but isn't (#305): open, not a draft or parked, approved by the
 * owner, CI green at its head, merge state CLEAN and auto-merge on. Reported once it has stayed so for
 * NOT_QUEUED_MINUTES, timed in the `unqueued` state file from the first look that saw it; any other
 * state (merged, queued, a new push) drops its line. Nothing to do where the branch has no queue.
 */
export const checkNotQueued = async (pr: number, state: PrState, green: boolean): Promise<void> => {
  if (!MERGE_QUEUE) {
    return
  }
  const waiting = state.state === 'OPEN' && !state.draft && !state.parked && !state.queued && state.ownerApproved && green
    && state.autoMerge && state.mergeState === 'CLEAN'
  const found = { overdue: false }
  await updateLines('unqueued', lines => {
    const after = unqueuedLines({ head: state.head, lines, now: Temporal.Now.instant(), pr, waiting })
    found.overdue = after.overdue
    return after.lines
  })
  await report(found.overdue ? notQueuedEvent({ gh: GH, head: state.head, id: state.id, pr }) : null, pr)
}
