/** What the watcher reports about the merge queue (#251), decided from what GitHub answered (pure, so it is tested). */
import type { Event } from './watch-events'

/** A PR's place in the merge queue (#251). */
export interface QueueEntry {
  position: number
  /** When it entered: a PR that leaves and enters again is news again. */
  enqueuedAt: string
}

/** A queued PR as the `queued` state file keeps it: `<pr> <when it entered>`. */
export const queueLine = (pr: number, entry: QueueEntry): string => `${pr} ${entry.enqueuedAt}`

/**
 * What changed in the queue since the last look, as `queued` lines: the PRs that entered it (also one
 * that entered again, with its new time) and the ones that left it, merged or not.
 */
export const queueChanges = (before: readonly string[], now: readonly string[]): { entered: string[], left: string[] } => ({
  entered: now.filter(line => !before.includes(line)),
  left: before.filter(line => !now.includes(line)),
})

export const queuedEvent = (pr: number, entry: QueueEntry): Event => ({
  key: `pr-${pr} queued ${entry.enqueuedAt}`,
  lines: [`QUEUED: in the merge queue at position ${entry.position}`],
})

/** A PR that left the merge queue still open: the one queue event that needs the agent (#251). */
export const dequeuedEvent = (pr: number, enqueuedAt: string, reason: string): Event => ({
  key: `pr-${pr} dequeued ${enqueuedAt}`,
  lines: [`DEQUEUED: left the merge queue without merging (${reason || 'GitHub gives no reason'}): fix what it says, then queue it again`],
})
