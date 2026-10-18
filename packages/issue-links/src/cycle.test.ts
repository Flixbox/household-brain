import { describe, expect, it } from 'bun:test'
import { blockingPath } from './cycle'

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
