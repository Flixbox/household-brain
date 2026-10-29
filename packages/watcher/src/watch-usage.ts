/**
 * When a watcher's notification ends with the owner's Claude usage line (#318). Posted with nearly
 * every notification, it mostly repeated the numbers before it, so a notification carries it only:
 *
 * - **on a step:** the session's or the week's use is in another 2.5% step (2.5%, 5%, 7.5% …) than in
 *   the last line this watcher posted, and a minute has passed since that line (the debounce the
 *   endpoint has, so use jittering around a step's edge posts at most once a minute);
 * - **as a heartbeat:** 10 minutes after the last line, whatever the numbers.
 *
 * Each watcher keeps its own last line (watch-state.ts's `usage`), as it does its events (#264).
 */
import { isRecord } from './read'

const STEP = 2.5
const MINUTE_MS = 60_000
const HEARTBEAT_MS = 10 * MINUTE_MS

/** The numbers a usage line showed (null for a window it couldn't tell), and when it was posted, in epoch milliseconds. */
export interface PostedUsage {
  at: number
  session: number | null
  week: number | null
}

const utilization = (window: unknown): number | null =>
  (isRecord(window) && typeof window.utilization === 'number' && Number.isFinite(window.utilization) ? window.utilization : null)

/** What a line posted at `at` from the endpoint's answer shows. */
export const shownUsage = (answer: unknown, at: number): PostedUsage => ({
  at,
  session: utilization(isRecord(answer) ? answer.five_hour : null),
  week: utilization(isRecord(answer) ? answer.seven_day : null),
})

const stepOf = (used: number | null): number | null => (used === null ? null : Math.floor(used / STEP))

/** Whether a notification now carries the usage line, after `last` (null: none posted yet). */
export const usageDue = (last: PostedUsage | null, now: PostedUsage): boolean => {
  if (last === null) {
    return true
  }
  const since = now.at - last.at
  const stepped = stepOf(last.session) !== stepOf(now.session) || stepOf(last.week) !== stepOf(now.week)
  return since >= HEARTBEAT_MS || (stepped && since >= MINUTE_MS)
}

const numberOrNull = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null)

/** The last line posted from its state line (JSON); null when there is none or it can't be read. */
export const postedFrom = (line: string): PostedUsage | null => {
  try {
    const value: unknown = JSON.parse(line)
    const at = isRecord(value) ? numberOrNull(value.at) : null
    return isRecord(value) && at !== null ? { at, session: numberOrNull(value.session), week: numberOrNull(value.week) } : null
  } catch {
    return null
  }
}
