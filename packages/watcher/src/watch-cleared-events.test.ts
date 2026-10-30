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
  const by = (login: string) => ({ kind: 'User', login })
  const labelled = (createdAt: string, actor = by('Owner'), name = 'subagent-cleared') => ({ actor, createdAt, kind: 'LabeledEvent', label: { name } })
  const unlabelled = (createdAt: string) => ({ actor: by('someone'), createdAt, kind: 'UnlabeledEvent', label: { name: 'subagent-cleared' } })
  const clearers = ['owner', 'agent[bot]']

  it('takes the last time the owner or the agent put the label on', () => {
    expect(clearedAt([
      labelled('2026-10-30T08:00:00Z'),
      labelled('2026-10-30T09:00:00Z', { kind: 'Bot', login: 'agent' }),
      labelled('2026-10-30T10:00:00Z', by('Owner'), 'parked'),
    ], clearers)).toBe('2026-10-30T09:00:00Z')
  })

  it('counts no one else\'s label', () => {
    expect(clearedAt([labelled('2026-10-30T08:00:00Z'), labelled('2026-10-30T09:00:00Z', by('passer-by'))], clearers)).toBe('2026-10-30T08:00:00Z')
    expect(clearedAt([labelled('2026-10-30T09:00:00Z', by('passer-by'))], clearers)).toBe('')
  })

  it('is empty when it never was, or was taken off since', () => {
    expect(clearedAt([labelled('2026-10-30T08:00:00Z', by('Owner'), 'parked')], clearers)).toBe('')
    expect(clearedAt([labelled('2026-10-30T08:00:00Z'), unlabelled('2026-10-30T09:00:00Z')], clearers)).toBe('')
    expect(clearedAt([labelled('2026-10-30T08:00:00Z'), unlabelled('2026-10-30T09:00:00Z'), labelled('2026-10-30T10:00:00Z', by('passer-by'))], clearers)).toBe('')
  })
})

describe('coveredByClearance (#327)', () => {
  const early = dismissal(1, '2026-10-30T08:00:00Z')
  const late = dismissal(2, '2026-10-30T10:00:00Z')

  it('covers only change requests submitted before the clearance', () => {
    expect(coveredByClearance([early, late], '2026-10-30T09:00:00Z')).toEqual([early])
  })

  it('covers none without a clearance, nor one with a time that isn\'t one', () => {
    expect(coveredByClearance([early, late], '')).toEqual([])
    expect(coveredByClearance([dismissal(3, 'yesterday')], '2026-10-30T09:00:00Z')).toEqual([])
  })
})
