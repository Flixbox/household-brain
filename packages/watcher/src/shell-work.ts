/**
 * How much the owner-write guard reads for one command line (#380). Nesting multiplies the readings
 * (`eval`, `bash -c`, `$(…)`), and a hook that times out denies nothing, so a line that spends its
 * budget counts as a write instead.
 */
import { dynamic } from './shell-ansi-c'

/** How many characters the guard reads for one command line, counting every re-reading. */
const workLimit = 1_000_000

/** What is left of the reading one command line may cost. */
export interface Work {
  left: number
}

export const newWork = (): Work => ({ left: workLimit })

/** Takes a reading of this text off the budget, and tells whether the budget is spent. */
export const spent = (work: Work, text: string) => {
  work.left -= text.length + 1
  return work.left < 0
}

/** A `gh` command the shell fills in, so a write: what the guard reports for a line it can't read. */
export const unreadableLine = () => [['gh', `${dynamic}$unreadable`]]
