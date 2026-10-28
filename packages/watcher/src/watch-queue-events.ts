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

/** How long an approved, green, CLEAN PR with auto-merge on may stay outside the queue before it is news (#305). */
export const NOT_QUEUED_MINUTES = 5

/**
 * The `unqueued` state file after a look at PR `pr` (#305): `<pr> <head> <since> <seen>` for each PR
 * seen waiting outside the queue, timed from the first look that saw it so at that head, and when a
 * look last did. A PR no longer waiting (queued, merged, a new push, auto-merge off) loses its line, and
 * so does a wait no look saw for NOT_QUEUED_MINUTES (the watcher was stopped: it may have been queued
 * meanwhile), which starts again. `overdue` says it has waited too long.
 */
export const unqueuedLines = ({ head, lines, now, pr, waiting }: { head: string, lines: readonly string[], now: Temporal.Instant, pr: number, waiting: boolean }): { lines: string[], overdue: boolean } => {
  const mine = (line: string) => line.split(' ')[0] === String(pr)
  const others = lines.filter(line => !mine(line))
  if (!waiting) {
    return { lines: others, overdue: false }
  }
  const minutesAgo = (at: string) => Temporal.Instant.from(at).until(now).total('minutes')
  const kept = lines.find(line => mine(line) && line.split(' ')[1] === head)?.split(' ') ?? []
  const since = kept[2] ?? now.toString()
  const seen = kept[3] ?? ''
  const start = seen !== '' && minutesAgo(seen) < NOT_QUEUED_MINUTES ? since : now.toString()
  return { lines: [...others, `${pr} ${head} ${start} ${now.toString()}`], overdue: minutesAgo(start) >= NOT_QUEUED_MINUTES }
}

/**
 * Approved, green, CLEAN and auto-merge on, yet GitHub never put it into the merge queue (#305): seen
 * on PRs whose change request was dismissed, or that were rebased after a conflict. Enabling auto-merge
 * again doesn't help; the `enqueuePullRequest` mutation queues it at once. Once per head commit.
 */
export const notQueuedEvent = ({ gh, head, id, pr }: { gh: string, head: string, id: string, pr: number }): Event => ({
  key: `pr-${pr} not-queued ${head}`,
  lines: [`NOT_QUEUED: approved, CI green, merge state CLEAN and auto-merge on at ${head.slice(0, 7)}, but not in the merge queue after ${NOT_QUEUED_MINUTES} min: queue it with ${gh} api graphql -f query='mutation{enqueuePullRequest(input:{pullRequestId:"${id}"}){mergeQueueEntry{position}}}'`],
})
