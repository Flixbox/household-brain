import { describe, expect, it } from 'vitest'
import { DEFAULT_CATEGORIES } from '../categories'
import { boardFor } from './board'
import type { Item } from './model'

const entry = (overrides: Partial<Item>): Item => ({
  amount: '',
  category: 'coupon',
  code: '',
  dirty: [],
  dueDate: '2026-11-03',
  etags: {},
  id: overrides.title ?? 'id',
  notes: '',
  pendingOp: null,
  rev: 'r1',
  startDate: '',
  status: 'open',
  sync: 'synced',
  syncError: null,
  title: 'Entry',
  url: '',
  ...overrides,
})

const items = [
  entry({ dueDate: '2026-12-01', title: 'Pizza' }),
  entry({ dueDate: '2026-11-01', title: 'Cinema' }),
  entry({ status: 'done', title: 'Old pizza' }),
  entry({ category: 'membership', title: 'Gym' }),
  entry({ pendingOp: 'delete', title: 'Pizza being deleted' }),
  entry({ category: 'party', title: 'Pizza party' }),
]
const board = (query: string, showCompleted = false) => boardFor({ categories: DEFAULT_CATEGORIES, items, query, showCompleted, today: '2026-10-02' })
const titles = (section?: { items: Item[] }) => section?.items.map(item => item.title)

describe('boardFor', () => {
  it('lists open entries by due date in every category, and counts the completed ones', () => {
    const result = board('')
    expect(result.sections).toHaveLength(DEFAULT_CATEGORIES.length)
    expect(titles(result.sections[0])).toEqual(['Cinema', 'Pizza'])
    expect(result.completed).toBe(1)
    expect(result.other.map(item => item.title)).toEqual(['Pizza party'])
  })

  it('also lists every listed entry in one list by due date', () => {
    // 11-01 Cinema, then the 11-03 ties by title (Gym, Pizza party), then 12-01 Pizza.
    expect(board('').flat.map(item => item.title)).toEqual(['Cinema', 'Gym', 'Pizza party', 'Pizza'])
  })

  it('adds completed entries only when asked to', () => {
    expect(titles(board('', true).sections[0])).toEqual(['Cinema', 'Old pizza', 'Pizza'])
  })

  it('searches every entry, completed ones included, and keeps only categories with a match', () => {
    const result = board('pizza')
    expect(result.searching).toBe(true)
    expect(result.sections.map(section => section.category.slug)).toEqual(['coupon'])
    expect(titles(result.sections[0])).toEqual(['Old pizza', 'Pizza'])
    expect(result.other.map(item => item.title)).toEqual(['Pizza party'])
    expect(board('sushi').empty).toBe(true)
  })

  it('sorts by the next date, which can be an extra date before the due date', () => {
    const early = entry({ dueDate: '2026-12-31', extraDates: [{ date: '2026-10-10', id: 'c', label: 'Cancel by' }], title: 'Has a deadline' })
    const result = boardFor({ categories: DEFAULT_CATEGORIES, items: [...items, early], query: '', showCompleted: false, today: '2026-10-02' })
    // Its deadline on 10-10 comes before Cinema (11-01) and Pizza (12-01), although it's due 12-31.
    expect(titles(result.sections[0])).toEqual(['Has a deadline', 'Cinema', 'Pizza'])
  })
})

describe('boardFor with an entry without dates (a balance)', () => {
  it('lists it after every dated entry', () => {
    const withBalance = [...items, entry({ category: 'coupon', dueDate: '', title: 'Gift card credit' })]
    const result = boardFor({ categories: DEFAULT_CATEGORIES, items: withBalance, query: '', showCompleted: false, today: '2026-10-02' })
    expect(titles(result.sections[0])).toEqual(['Cinema', 'Pizza', 'Gift card credit'])
    expect(result.flat.at(-1)?.title).toBe('Gift card credit')
  })
})
