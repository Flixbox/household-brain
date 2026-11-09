/** The deadlock check (#256), apart from GitHub so it is tested. */

/**
 * The chain by which `from` is already blocked, transitively, by `target`, or null when it isn't:
 * `[from, …, target]`. Each issue is asked for its blockers once, so a cycle elsewhere ends the walk.
 */
export const blockingPath = async (from: string, target: string, blockersOf: (issue: string) => Promise<string[]>): Promise<string[] | null> => {
  const cameFrom = new Map<string, string | null>([[from, null]])
  const pathTo = (issue: string): string[] => {
    const before = cameFrom.get(issue) ?? null
    return before === null ? [issue] : [...pathTo(before), issue]
  }
  const walk = async (frontier: string[]): Promise<string[] | null> => {
    if (frontier.includes(target)) {
      return pathTo(target)
    }
    const next = (await Promise.all(frontier.map(async issue => (await blockersOf(issue)).map(blocker => [blocker, issue] as const)))).flat()
      .filter(([blocker]) => !cameFrom.has(blocker))
    for (const [blocker, issue] of next) {
      cameFrom.set(blocker, cameFrom.has(blocker) ? cameFrom.get(blocker) ?? null : issue)
    }
    return next.length === 0 ? null : walk([...new Set(next.map(([blocker]) => blocker))])
  }
  return walk([from])
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
 * Every cycle in a repository's "blocked by" links (#334), each as the path from an issue back to
 * itself: `[a, b, …, a]`, a blocked by b and so on; a self-link is `[a, a]`. `blockersOf` maps an
 * issue to the issues it is blocked by. Each cycle starts at its issue that comes first in
 * `blockersOf`, and the walk from an issue goes only through issues after it, so a cycle is listed
 * once, cycles sharing issues each on their own, and two paths to one blocker (a diamond) are none.
 * At most MAX_CYCLES. The work grows with the links and the cycles listed, not with the paths (#548).
 */
export const findCycles = (blockersOf: ReadonlyMap<string, readonly string[]>): string[][] => {
  const order = new Map([...blockersOf.keys()].map((issue, at) => [issue, at]))
  const cycles: string[][] = []
  for (const start of blockersOf.keys()) {
    const after = order.get(start) ?? -1
    addCyclesThrough(start, issue => (blockersOf.get(issue) ?? []).filter(blocker => blocker === start || (order.get(blocker) ?? -1) > after), cycles)
  }
  return cycles
}
