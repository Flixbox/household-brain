import { describe, expect, it } from 'bun:test'
import { clearedAt, coveredByClearance, dismissesCleared } from './watch-cleared-events'
import type { Dismissal } from './watch-review-events'

const dismissal = (id: number, submittedAt: string): Dismissal =>
  ({ replies: [], review: { commit: 'abc', id, login: 'coderabbitai[bot]', state: 'CHANGES_REQUESTED', submittedAt } })

describe('dismissesCleared (#327)', () => {
  const cleared = { cleared: true, decision: 'CHANGES_REQUESTED', draft: false, enabled: true, green: true, ownerApproved: false }

  it('dismisses on a labelled, green PR that changes are requested on', () => {
    expect(dismissesCleared(cleared)).toBe(true)
  })

  it('leaves every other PR alone', () => {
    expect(dismissesCleared({ ...cleared, cleared: false })).toBe(false)
    expect(dismissesCleared({ ...cleared, enabled: false })).toBe(false)
    expect(dismissesCleared({ ...cleared, green: false })).toBe(false)
    expect(dismissesCleared({ ...cleared, draft: true })).toBe(false)
    expect(dismissesCleared({ ...cleared, decision: '' })).toBe(false)
    // The owner's approval takes the usual way (BLOCKED_BY_REVIEW and its dismissal).
    expect(dismissesCleared({ ...cleared, ownerApproved: true })).toBe(false)
  })
})

describe('clearedAt (#327)', () => {
  it('takes the last time the label was put on', () => {
    expect(clearedAt([
      { createdAt: '2026-10-30T08:00:00Z', label: { name: 'subagent-cleared' } },
      { createdAt: '2026-10-30T09:00:00Z', label: { name: 'subagent-cleared' } },
      { createdAt: '2026-10-30T10:00:00Z', label: { name: 'parked' } },
    ])).toBe('2026-10-30T09:00:00Z')
  })

  it('is empty when it never was', () => {
    expect(clearedAt([{ createdAt: '2026-10-30T08:00:00Z', label: { name: 'parked' } }])).toBe('')
  })
})

describe('coveredByClearance (#327)', () => {
  const early = dismissal(1, '2026-10-30T08:00:00Z')
  const late = dismissal(2, '2026-10-30T10:00:00Z')

  it('covers only change requests submitted before the clearance', () => {
    expect(coveredByClearance([early, late], '2026-10-30T09:00:00Z')).toEqual([early])
  })

  it('covers none without a clearance', () => {
    expect(coveredByClearance([early, late], '')).toEqual([])
  })
})
