import { describe, expect, it } from 'bun:test'
import { type ItemDraft, checkedDraft, draftProblems, repairedDraft } from './draft'
import { emptyDraft } from './model'

const valid: ItemDraft = {
  ...emptyDraft('coupon'),
  amount: '9,99',
  dueDate: '2026-12-31',
  interval: 'monthly',
  startDate: '2026-01-01',
  title: 'Cinema voucher',
  url: 'https://cinema.test/deal',
}

describe('draftProblems', () => {
  it('passes what the form saves, also without dates or an amount', () => {
    expect(draftProblems(valid)).toEqual([])
    expect(draftProblems({ ...emptyDraft('coupon'), title: 'A gift card credit' })).toEqual([])
  })

  it('names each rule a draft breaks', () => {
    expect(draftProblems({ ...valid, title: '  ' })).toEqual(['Enter a title'])
    expect(draftProblems({ ...valid, category: '' })).toEqual(['Choose a category'])
    expect(draftProblems({ ...valid, dueDate: '2026-02-30' })).toEqual(['Enter a real due date'])
    expect(draftProblems({ ...valid, startDate: '1.1.2026' })).toEqual(['Enter a real start date'])
    expect(draftProblems({ ...valid, amount: '10 €' })).toEqual(['Enter the amount as a number, e.g. 9.99'])
    expect(draftProblems({ ...valid, currency: 'real' })).toEqual(['Choose a currency'])
    expect(draftProblems({ ...valid, interval: 'fortnightly' })).toEqual(['Choose how often it is due'])
    expect(draftProblems({ ...valid, url: 'no address' })).toEqual(['Enter a web address, e.g. example.de'])
  })

  it('refuses a start date after the due date, but not one without a due date', () => {
    expect(draftProblems({ ...valid, startDate: '2027-01-01' })).toEqual(['The start date can’t be after the due date'])
    expect(draftProblems({ ...valid, dueDate: '', startDate: '2027-01-01' })).toEqual([])
  })
})

describe('checkedDraft', () => {
  it('lets a valid draft through and refuses one that breaks a rule', () => {
    expect(checkedDraft(valid)).toBe(valid)
    expect(() => checkedDraft({ ...valid, title: '' })).toThrow('Not saved: Enter a title')
  })
})

describe('repairedDraft', () => {
  it('leaves a valid draft alone', () => {
    expect(repairedDraft(valid)).toEqual({ draft: valid, repairs: [] })
  })

  it('makes a draft from Google pass, keeping what was typed in the notes', () => {
    const { draft, repairs } = repairedDraft({
      ...valid, amount: 'ten', category: '', notes: 'Only online', startDate: '2027-01-01', title: ' ', url: 'see the flyer',
    })
    expect(draftProblems(draft)).toEqual([])
    expect(draft).toMatchObject({ amount: '', category: 'uncategorised', startDate: '', title: 'Untitled', url: '' })
    expect(draft.notes).toBe('Only online\nStart date: 2027-01-01\nAmount: ten\nLink: see the flyer')
    expect(repairs).toHaveLength(5)
  })

  it('drops a currency or interval it doesn\'t know', () => {
    const { draft, repairs } = repairedDraft({ ...valid, currency: 'real', interval: 'fortnightly' })
    expect(draft).toMatchObject({ currency: '', interval: '' })
    expect(repairs).toEqual(['unknown currency: euros', 'unknown interval: one-off'])
  })
})
