import { describe, expect, it } from 'vitest'
import { changedFields, editField, emptyDraft, followUntouched, openForm } from './model'

describe('followUntouched', () => {
  const opened = { ...emptyDraft('coupon'), code: 'OLD10', dueDate: '2026-12-01', title: 'Bakery' }

  it('lets fields not typed in take the newer value', () => {
    const next = { ...opened, code: 'NEW20' }
    expect(followUntouched(openForm(opened), next)).toEqual({ draft: next, latest: next, touched: [] })
  })

  it('keeps a field typed in here, so saving still sends it', () => {
    const state = editField(openForm(opened), 'title', 'Bakery Müller')
    const next = { ...opened, code: 'NEW20', title: 'Bäckerei' }
    expect(followUntouched(state, next)).toEqual({ draft: { ...next, title: 'Bakery Müller' }, latest: next, touched: ['title'] })
  })

  it('keeps a field typed back to its old value, which then differs from the latest and is saved', () => {
    const typed = editField(editField(openForm(opened), 'code', 'X'), 'code', 'OLD10')
    const state = followUntouched(typed, { ...opened, code: 'NEW20' })
    expect(state.draft.code).toBe('OLD10')
    expect(changedFields(state.latest, state.draft)).toEqual(['code'])
  })

  it('returns the same state when nothing new arrived', () => {
    const state = openForm(opened)
    expect(followUntouched(state, { ...opened })).toBe(state)
  })
})
