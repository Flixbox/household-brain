/* oxlint-disable eslint/capitalized-comments -- fallow reads its ignore comments in lower case; this stand-in goes with the fix */
/** Stand-in until #402's fix: every watcher writes, every look, and relays nothing. */
import type { Event } from './watch-events'
import { report } from './watch-output'

// fallow-ignore-next-line unused-export
export const attemptWrite = async (_key: string, write: () => Promise<boolean | null>): Promise<boolean | null> => write()

// fallow-ignore-next-line unused-export
export const reportWrite = async (event: Event | null, pr: number): Promise<void> => report(event, pr)

export const relayWrites = async (_pr: number): Promise<void> => {
  await Promise.resolve()
}
