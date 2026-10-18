import { describe, expect, it } from 'bun:test'
import { dequeuedEvent, queueChanges, queuedEvent } from './watch-queue-events'

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
