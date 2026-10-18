/** The project watcher's look at the merge queue (watch-project.ts, #251): who entered it, who fell off. */
import { dequeueReason, prStates, queueEntries } from './watch-github'
import { type QueueEntry, dequeuedEvent, queueChanges, queueLine, queuedEvent } from './watch-queue-events'
import { exists, readLines, updateLines, writeLines } from './watch-state'
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
