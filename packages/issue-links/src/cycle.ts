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

/**
 * Every cycle in a repository's "blocked by" links (#334), each as the path from an issue back to
 * itself: `[a, b, …, a]`, a blocked by b and so on; a self-link is `[a, a]`. `blockersOf` maps an
 * issue to the issues it is blocked by. A depth-first walk reports each link that leads back into the
 * path it is on, so two paths to the same blocker (a diamond) are no cycle, and each issue is walked
 * from once.
 */
export const findCycles = (blockersOf: ReadonlyMap<string, readonly string[]>): string[][] => {
  const done = new Set<string>()
  const cycles: string[][] = []
  const visit = (issue: string, path: string[]): void => {
    const at = path.indexOf(issue)
    if (at !== -1) {
      cycles.push([...path.slice(at), issue])
      return
    }
    if (done.has(issue)) {
      return
    }
    for (const blocker of blockersOf.get(issue) ?? []) {
      visit(blocker, [...path, issue])
    }
    done.add(issue)
  }
  for (const issue of blockersOf.keys()) {
    visit(issue, [])
  }
  return cycles
}
