/** Cycles in the "blocked by" links between open issues, as LINK_CYCLE reports them (#335; pure, so it is tested). */

/** An open issue, and the open issues of the same repository it is blocked by. */
export interface OpenIssue {
  blockedBy: number[]
  number: number
}

/** The most cycles `findCycles` lists: their number can grow very fast, and a few are enough to act on. */
export const MAX_CYCLES = 100

/**
 * A copy of `findCycles` in `packages/issue-links/src/cycle.ts` (#334): each plugin is installed as
 * its own folder, so the watcher can't import it. Change both together.
 *
 * Every cycle in a repository's "blocked by" links, each as the path from an issue back to itself:
 * `[a, b, …, a]`, a blocked by b and so on; a self-link is `[a, a]`. `blockersOf` maps an issue to
 * the issues it is blocked by. Each cycle starts at its issue that comes first in `blockersOf`, and
 * the walk from an issue goes only through issues after it, so a cycle is listed once, cycles sharing
 * issues each on their own, and two paths to one blocker (a diamond) are none. At most MAX_CYCLES.
 */
const findCycles = (blockersOf: ReadonlyMap<string, readonly string[]>): string[][] => {
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
