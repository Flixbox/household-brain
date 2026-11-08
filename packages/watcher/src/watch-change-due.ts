/** Which pull requests the change gate (watch-change-gate.ts) reads in full (pure, so it is tested). */

// FULL_READ_MINUTES: how long a PR goes without a full read at most, for what moves nothing in the gate.
const FULL_READ_MS = Number(process.env.FULL_READ_MINUTES ?? 10) * 60_000

export interface FullRead {
  at: number
  print: string
}

/** The PRs to read in full: never read, not in the gate's answer, changed since, or read too long ago. */
export const duePrs = ({ known, now, prints, prs, refreshMs = FULL_READ_MS }: { known: ReadonlyMap<number, FullRead>, now: number, prints: ReadonlyMap<number, string>, prs: readonly number[], refreshMs?: number }): number[] =>
  prs.filter(pr => {
    const read = known.get(pr)
    const print = prints.get(pr) ?? ''
    return !read || print === '' || read.print !== print || now - read.at >= refreshMs
  })
