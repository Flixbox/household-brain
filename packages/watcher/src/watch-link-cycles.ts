/** Cycles in the "blocked by" links between open issues, as LINK_CYCLE reports them (#335; pure, so it is tested). */

/** An open issue, and the open issues of the same repository it is blocked by. */
export interface OpenIssue {
  blockedBy: number[]
  number: number
}

/** The most cycles `findCycles` lists: their number can grow very fast, and a few are enough to act on. */
export const MAX_CYCLES = 100

/**
 * Adds the cycles through `start` to `cycles`, up to MAX_CYCLES, walking only the links `next` gives.
 * An issue stays blocked after a walk from it found no way back to `start`, until an issue on that
 * dead end is released (Johnson's algorithm), so dead ends aren't walked again by every path to them.
 */
const addCyclesThrough = (start: string, next: (issue: string) => readonly string[], cycles: string[][]): void => {
  const blocked = new Set<string>()
  const waiting = new Map<string, Set<string>>()
  const path: string[] = []
  const release = (issue: string): void => {
    blocked.delete(issue)
    const waiters = waiting.get(issue) ?? []
    waiting.delete(issue)
    for (const waiter of waiters) {
      if (blocked.has(waiter)) {
        release(waiter)
      }
    }
  }
  const waitOn = (issue: string): void => {
    for (const blocker of next(issue)) {
      waiting.set(blocker, (waiting.get(blocker) ?? new Set<string>()).add(issue))
    }
  }
  const closes = (blocker: string, walk: (issue: string) => boolean): boolean => {
    if (blocker === start) {
      cycles.push([...path, start])
      return true
    }
    return !blocked.has(blocker) && walk(blocker)
  }
  const walk = (issue: string): boolean => {
    blocked.add(issue)
    path.push(issue)
    let found = false
    for (const blocker of next(issue)) {
      if (cycles.length < MAX_CYCLES) {
        found = closes(blocker, walk) || found
      }
    }
    path.pop()
    const settle = found ? release : waitOn
    settle(issue)
    return found
  }
  walk(start)
}

/**
 * A copy of `findCycles` in `packages/issue-links/src/cycle.ts` (#334), with its helper above: each
 * plugin is installed as its own folder, so the watcher can't import it. Change both together.
 *
 * Every cycle in a repository's "blocked by" links, each as the path from an issue back to itself:
 * `[a, b, …, a]`, a blocked by b and so on; a self-link is `[a, a]`. `blockersOf` maps an issue to
 * the issues it is blocked by. Each cycle starts at its issue that comes first in `blockersOf`, and
 * the walk from an issue goes only through issues after it, so a cycle is listed once, cycles sharing
 * issues each on their own, and two paths to one blocker (a diamond) are none. At most MAX_CYCLES.
 * The work is a walk over the links from each issue, plus the cycles listed, not every path (#548).
 */
const findCycles = (blockersOf: ReadonlyMap<string, readonly string[]>): string[][] => {
  const order = new Map([...blockersOf.keys()].map((issue, at) => [issue, at]))
  const cycles: string[][] = []
  for (const start of blockersOf.keys()) {
    const after = order.get(start) ?? -1
    addCyclesThrough(start, issue => (blockersOf.get(issue) ?? []).filter(blocker => blocker === start || (order.get(blocker) ?? -1) > after), cycles)
  }
  return cycles
}

/**
 * Every cycle among the open issues' links, as `#a → #b → #a`. The issues go in by number, so each
 * cycle starts at its lowest issue and reads the same on every look. A link to an issue that isn't
 * open holds nothing up, and is left out.
 */
export const linkCycles = (issues: readonly OpenIssue[]): string[] => {
  const open = new Set(issues.map(({ number }) => `#${number}`))
  const links = issues.toSorted((first, second) => first.number - second.number)
    .map(({ blockedBy, number }): [string, string[]] => [`#${number}`, blockedBy.map(blocker => `#${blocker}`).filter(blocker => open.has(blocker))])
  return findCycles(new Map(links)).map(cycle => cycle.join(' → '))
}

/** The cycles in `now` that weren't there on the last look: one that stays isn't news, one that comes back after a fix is. */
export const newCycles = (before: readonly string[], now: readonly string[]): string[] => now.filter(cycle => !before.includes(cycle))
