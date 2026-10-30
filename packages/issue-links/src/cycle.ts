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
 * Every cycle in a repository's "blocked by" links (#334), each as the path from an issue back to
 * itself: `[a, b, …, a]`, a blocked by b and so on; a self-link is `[a, a]`. `blockersOf` maps an
 * issue to the issues it is blocked by. Each cycle starts at its issue that comes first in
 * `blockersOf`, and the walk from an issue goes only through issues after it, so a cycle is listed
 * once, cycles sharing issues each on their own, and two paths to one blocker (a diamond) are none.
 * At most MAX_CYCLES.
 */
export const findCycles = (blockersOf: ReadonlyMap<string, readonly string[]>): string[][] => {
  const order = new Map([...blockersOf.keys()].map((issue, at) => [issue, at]))
  const cycles: string[][] = []
  const walk = (start: string, path: string[]): void => {
    const after = order.get(start) ?? -1
    for (const blocker of blockersOf.get(path.at(-1) ?? start) ?? []) {
      if (cycles.length >= MAX_CYCLES) {
        return
      }
      if (blocker === start) {
        cycles.push([...path, start])
      } else if ((order.get(blocker) ?? -1) > after && !path.includes(blocker)) {
        walk(start, [...path, blocker])
      }
    }
  }
  for (const start of blockersOf.keys()) {
    walk(start, [start])
  }
  return cycles
}
