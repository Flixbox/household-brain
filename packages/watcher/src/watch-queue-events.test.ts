import { describe, expect, it } from 'bun:test'
import { NOT_QUEUED_MINUTES, dequeuedEvent, notQueuedEvent, queueChanges, queuedEvent, unqueuedLines } from './watch-queue-events'

describe('merge queue events (#251)', () => {
  it('reports a PR entering the queue, keyed by when it entered so a second time is news again', () => {
    expect(queuedEvent(7, { enqueuedAt: '2026-10-18T09:00:00Z', position: 2 })).toEqual({ key: 'pr-7 queued 2026-10-18T09:00:00Z', lines: ['QUEUED: in the merge queue at position 2'] })
  })

  it('finds who entered and who left between two looks, a second entry included', () => {
    expect(queueChanges(['7 t1', '8 t1'], ['8 t1', '9 t2'])).toEqual({ entered: ['9 t2'], left: ['7 t1'] })
    // Left and entered again between looks: the old entry left, the new one entered.
    expect(queueChanges(['7 t1'], ['7 t3'])).toEqual({ entered: ['7 t3'], left: ['7 t1'] })
    expect(queueChanges(['7 t1'], ['7 t1'])).toEqual({ entered: [], left: [] })
  })

  it('reports a PR that fell off, with the reason when GitHub gives one', () => {
    expect(dequeuedEvent(7, '2026-10-18T09:00:00Z', 'Merge conflict').lines[0]).toContain('(Merge conflict)')
    expect(dequeuedEvent(7, '2026-10-18T09:00:00Z', '')).toMatchObject({ key: 'pr-7 dequeued 2026-10-18T09:00:00Z', lines: [expect.stringContaining('GitHub gives no reason')] })
  })
})

describe('a PR that never joins the merge queue (#305)', () => {
  const start = Temporal.Instant.from('2026-10-28T12:00:00Z')
  const later = (minutes: number) => start.add({ minutes })

  it('starts timing a waiting PR on the first look, and is overdue only after the wait', () => {
    const first = unqueuedLines({ head: 'abc', lines: ['8 def 2026-10-28T11:00:00Z'], now: start, pr: 7, waiting: true })
    expect(first).toEqual({ lines: ['8 def 2026-10-28T11:00:00Z', '7 abc 2026-10-28T12:00:00Z'], overdue: false })
    expect(unqueuedLines({ head: 'abc', lines: first.lines, now: later(NOT_QUEUED_MINUTES - 1), pr: 7, waiting: true }).overdue).toBe(false)
    expect(unqueuedLines({ head: 'abc', lines: first.lines, now: later(NOT_QUEUED_MINUTES), pr: 7, waiting: true })).toEqual({ lines: first.lines, overdue: true })
  })

  it('starts again on a new head, and forgets a PR that no longer waits', () => {
    const lines = ['7 abc 2026-10-28T12:00:00Z', '8 def 2026-10-28T11:00:00Z']
    expect(unqueuedLines({ head: 'new', lines, now: later(30), pr: 7, waiting: true })).toEqual({ lines: ['8 def 2026-10-28T11:00:00Z', '7 new 2026-10-28T12:30:00Z'], overdue: false })
    expect(unqueuedLines({ head: 'abc', lines, now: later(30), pr: 7, waiting: false })).toEqual({ lines: ['8 def 2026-10-28T11:00:00Z'], overdue: false })
    // A PR number that starts another's (7 and 70) is a different PR.
    expect(unqueuedLines({ head: 'x', lines: ['70 x 2026-10-28T12:00:00Z'], now: start, pr: 7, waiting: false }).lines).toEqual(['70 x 2026-10-28T12:00:00Z'])
  })

  it('names the enqueuePullRequest mutation with the PR\'s node id, once per head', () => {
    const event = notQueuedEvent({ gh: 'agent-gh', head: 'abcdef1234', id: 'PR_kw1', pr: 7 })
    expect(event.key).toBe('pr-7 not-queued abcdef1234')
    expect(event.lines[0]).toStartWith('NOT_QUEUED: ')
    expect(event.lines[0]).toContain(`agent-gh api graphql -f query='mutation{enqueuePullRequest(input:{pullRequestId:"PR_kw1"}){mergeQueueEntry{position}}}'`)
  })
})
