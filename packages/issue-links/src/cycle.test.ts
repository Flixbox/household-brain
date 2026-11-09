import { describe, expect, it } from 'bun:test'
import { MAX_CYCLES, blockingPath, findCycles } from './cycle'

/** Blockers as a map: issue → the issues it is blocked by. */
const graph = (edges: Record<string, string[]>) => async (issue: string) => edges[issue] ?? []

describe('blockingPath (#256)', () => {
  it('finds the chain by which an issue is already blocked by another, however long', async () => {
    // #2 is blocked by #3, #3 by #1: #1 blocked by #2 would close #1 → #2 → #3 → #1.
    expect(await blockingPath('#2', '#1', graph({ '#2': ['#3'], '#3': ['#1'] }))).toEqual(['#2', '#3', '#1'])
    expect(await blockingPath('#2', '#1', graph({ '#2': ['#1'] }))).toEqual(['#2', '#1'])
  })

  it('finds none when there is none, also through a cycle elsewhere', async () => {
    expect(await blockingPath('#2', '#1', graph({ '#2': ['#3', '#4'], '#3': ['#4'], '#4': ['#3'] }))).toBeNull()
    expect(await blockingPath('#2', '#1', graph({}))).toBeNull()
  })

  it('asks each issue once', async () => {
    const asked: string[] = []
    const edges: Record<string, string[]> = { '#2': ['#3', '#4'], '#3': ['#5'], '#4': ['#5'], '#5': [] }
    await blockingPath('#2', '#1', async issue => {
      asked.push(issue)
      return edges[issue] ?? []
    })
    expect(asked.toSorted()).toEqual(['#2', '#3', '#4', '#5'])
  })
})

describe('findCycles (#334)', () => {
  const edges = (blockers: Record<string, string[]>) => new Map(Object.entries(blockers))

  it('finds a cycle across several issues, as the path back to where it starts', () => {
    expect(findCycles(edges({ '#1': ['#2'], '#2': ['#3'], '#3': ['#1'], '#4': ['#1'] }))).toEqual([['#1', '#2', '#3', '#1']])
  })

  it('finds an issue blocked by itself', () => {
    expect(findCycles(edges({ '#1': ['#1'], '#2': ['#1'] }))).toEqual([['#1', '#1']])
  })

  it('finds each of several cycles once', () => {
    expect(findCycles(edges({ '#1': ['#2'], '#2': ['#1'], '#3': ['#4'], '#4': ['#3'], '#5': ['#1', '#3'] })))
      .toEqual([['#1', '#2', '#1'], ['#3', '#4', '#3']])
  })

  it('finds cycles that share issues, each on its own', () => {
    // Unblocking one link of the first two alone would leave #1 → #3 → #1.
    expect(findCycles(edges({ '#1': ['#2', '#3'], '#2': ['#3'], '#3': ['#1', '#2'] })))
      .toEqual([['#1', '#2', '#3', '#1'], ['#1', '#3', '#1'], ['#2', '#3', '#2']])
  })

  it('stops at MAX_CYCLES', () => {
    // Every issue blocked by every other: far more cycles than that.
    const issues = ['#1', '#2', '#3', '#4', '#5', '#6', '#7', '#8']
    expect(findCycles(new Map(issues.map(issue => [issue, issues.filter(other => other !== issue)])))).toHaveLength(MAX_CYCLES)
  })

  it('raises no alarm on two paths to the same blocker (a diamond) or a blocker it was not given', () => {
    expect(findCycles(edges({ '#1': ['#2', '#3'], '#2': ['#4'], '#3': ['#4'], '#4': ['#9'] }))).toEqual([])
    expect(findCycles(edges({}))).toEqual([])
  })

  /** A chain of diamonds from `#d0`, in walking order, that ends in the given blockers (#548). */
  const diamonds = (count: number, last: string[]): [string, string[]][] => [
    ...Array.from({ length: count }, (_, at): [string, string[]][] => [
      [`#d${at}`, [`#l${at}`, `#r${at}`]],
      [`#l${at}`, [`#d${at + 1}`]],
      [`#r${at}`, [`#d${at + 1}`]],
    ]).flat(),
    [`#d${count}`, last],
  ]

  /** The links as a map that counts how often it is read: a synchronous walk can't be timed out. */
  const counted = (links: [string, string[]][]) => {
    const blockersOf = new Map(links)
    const read = blockersOf.get.bind(blockersOf)
    const counter = { reads: 0 }
    blockersOf.get = issue => {
      counter.reads += 1
      return read(issue)
    }
    return { blockersOf, counter, limit: links.length ** 2 }
  }

  it('reads a graph of many diamonds a bounded number of times, with no cycle to stop at (#548)', () => {
    const { blockersOf, counter, limit } = counted(diamonds(20, []))
    expect(findCycles(blockersOf)).toEqual([])
    expect(counter.reads).toBeLessThanOrEqual(limit)
  })

  it('does not retry dead ends behind a real cycle, and still reports it (#548)', () => {
    // Every way through the diamonds comes back to #x, already on the path from #s: only #x → #s closes #s's cycle.
    const { blockersOf, counter, limit } = counted([['#s', ['#x']], ['#x', ['#d0', '#s']], ...diamonds(20, ['#x'])])
    const cycles = findCycles(blockersOf)
    expect(cycles[0]).toEqual(['#s', '#x', '#s'])
    expect(cycles).toHaveLength(MAX_CYCLES)
    expect(counter.reads).toBeLessThanOrEqual(limit)
  })
})
