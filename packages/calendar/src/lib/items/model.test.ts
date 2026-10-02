import { describe, expect, it } from 'vitest'
import { emptyDraft, followUntouched } from './model'

describe('followUntouched', () => {
  const opened = { ...emptyDraft('coupon'), code: 'OLD10', dueDate: '2026-12-01', title: 'Bakery' }

  it('lets fields not edited here take the newer value', () => {
    const next = { ...opened, code: 'NEW20' }
    expect(followUntouched({ base: opened, draft: opened }, next)).toEqual({ base: next, draft: next })
  })

  it('keeps a field edited here, and its base, so saving still sends it', () => {
    const state = { base: opened, draft: { ...opened, title: 'Bakery Müller' } }
    const next = { ...opened, code: 'NEW20', title: 'Bäckerei' }
    expect(followUntouched(state, next)).toEqual({
      base: { ...opened, code: 'NEW20' },
      draft: { ...opened, code: 'NEW20', title: 'Bakery Müller' },
    })
  })

  it('returns the same state when nothing new arrived', () => {
    const state = { base: opened, draft: opened }
    expect(followUntouched(state, { ...opened })).toBe(state)
  })
})
