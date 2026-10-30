import { describe, expect, it } from 'bun:test'
import { blockingPath, findCycles } from './cycle'

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

  it('raises no alarm on two paths to the same blocker (a diamond) or a blocker it was not given', () => {
    expect(findCycles(edges({ '#1': ['#2', '#3'], '#2': ['#4'], '#3': ['#4'], '#4': ['#9'] }))).toEqual([])
    expect(findCycles(edges({}))).toEqual([])
  })
})
