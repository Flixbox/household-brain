import { describe, expect, it } from 'bun:test'
import { changedFields, emptyDraft } from './model'

describe('changedFields', () => {
  const opened = { ...emptyDraft('coupon'), code: 'OLD10', dueDate: '2026-12-01', title: 'Bakery' }

  it('names the fields whose value differs', () => {
    expect(changedFields(opened, { ...opened, code: 'NEW20', title: 'Bäckerei' })).toEqual(['title', 'code'])
    expect(changedFields(opened, { ...opened })).toEqual([])
  })
})
