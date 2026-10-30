import { describe, expect, it } from 'bun:test'
import { linkCycles, newCycles } from './watch-link-cycles'

describe('linkCycles (#335)', () => {
  it('lists each cycle once, from its lowest issue, whatever order GitHub answers in', () => {
    const issues = [{ blockedBy: [3], number: 5 }, { blockedBy: [5], number: 3 }, { blockedBy: [3], number: 8 }]
    expect(linkCycles(issues)).toEqual(['#3 → #5 → #3'])
    expect(linkCycles(issues.toReversed())).toEqual(['#3 → #5 → #3'])
  })

  it('finds a self-link and a longer cycle, and no cycle in a diamond', () => {
    expect(linkCycles([{ blockedBy: [4], number: 4 }])).toEqual(['#4 → #4'])
    expect(linkCycles([{ blockedBy: [2], number: 1 }, { blockedBy: [3], number: 2 }, { blockedBy: [1], number: 3 }])).toEqual(['#1 → #2 → #3 → #1'])
    expect(linkCycles([{ blockedBy: [2, 3], number: 1 }, { blockedBy: [4], number: 2 }, { blockedBy: [4], number: 3 }, { blockedBy: [], number: 4 }])).toEqual([])
  })

  it('leaves out a link to an issue that is not open', () => {
    expect(linkCycles([{ blockedBy: [2], number: 1 }])).toEqual([])
  })
})

describe('newCycles (#335)', () => {
  it('reports a cycle once, not again while it stays, and again when it comes back after a fix', () => {
    const cycle = '#3 → #5 → #3'
    expect(newCycles([], [cycle])).toEqual([cycle])
    expect(newCycles([cycle], [cycle])).toEqual([])
    expect(newCycles([cycle], [])).toEqual([])
    expect(newCycles([], [cycle])).toEqual([cycle])
  })

  it('reports only the new one of several', () => {
    expect(newCycles(['#1 → #2 → #1'], ['#1 → #2 → #1', '#4 → #4'])).toEqual(['#4 → #4'])
  })
})
