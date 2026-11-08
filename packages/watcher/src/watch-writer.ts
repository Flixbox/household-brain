/** Stand-in until #402's fix: every watcher writes, every look, and relays nothing. */
import type { Event } from './watch-events'
import { report } from './watch-output'

export const retryDelayMs = (_failures: number): number => 0

export const attemptWrite = async (_key: string, write: () => Promise<boolean | null>): Promise<boolean | null> => write()

export const reportWrite = async (event: Event | null, pr: number): Promise<void> => report(event, pr)

export const relayWrites = async (_pr: number): Promise<void> => {
  await Promise.resolve()
}
