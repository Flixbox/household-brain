import { describe, expect, it } from 'vitest'
import { DEFAULT_CATEGORIES, RETIRED_DEFAULTS, categoryOfTag, missingDefaults, visibleCategories } from './categories'

describe('missingDefaults', () => {
  it('returns the defaults a set-up household is missing', () => {
    const existing = DEFAULT_CATEGORIES.filter(category => category.slug !== 'paperwork')
    expect(missingDefaults(existing).map(category => category.slug)).toEqual(['paperwork'])
  })

  it('returns nothing when every default is there, renamed or not', () => {
    expect(missingDefaults(DEFAULT_CATEGORIES.map(category => ({ label: 'Renamed', slug: category.slug })))).toEqual([])
  })

  it('leaves a household without categories to the setup', () => {
    expect(missingDefaults([])).toEqual([])
  })
})

describe('RETIRED_DEFAULTS', () => {
  it('names no current default', () => {
    expect(DEFAULT_CATEGORIES.filter(category => RETIRED_DEFAULTS.includes(category.slug))).toEqual([])
  })
})

describe('visibleCategories', () => {
  const categories = [{ slug: 'coupon' }, { slug: 'document' }]

  it('hides a retired default no entry uses', () => {
    expect(visibleCategories(categories, [{ category: 'coupon' }])).toEqual([{ slug: 'coupon' }])
  })

  it('keeps a retired default while an entry uses it', () => {
    expect(visibleCategories(categories, [{ category: 'document' }])).toEqual(categories)
  })
})

describe('categoryOfTag', () => {
  it('finds a category by its label or one of its words, ignoring case and spaces (#92)', () => {
    expect(categoryOfTag('coupon', DEFAULT_CATEGORIES)?.slug).toBe('coupon')
    expect(categoryOfTag(' DEAL ', DEFAULT_CATEGORIES)?.slug).toBe('coupon')
    expect(categoryOfTag('Rücksendung', DEFAULT_CATEGORIES)?.slug).toBe('paperwork')
    expect(categoryOfTag('Party', DEFAULT_CATEGORIES)).toBeNull()
    expect(categoryOfTag('', DEFAULT_CATEGORIES)).toBeNull()
  })

  it('prefers a label over a word, so a category the household named "Deal" wins', () => {
    const own = [...DEFAULT_CATEGORIES, { colorId: '4', label: 'Deal', slug: 'deal', sortOrder: 9 }]
    expect(categoryOfTag('deal', own)?.slug).toBe('deal')
  })

  it('only knows words for categories that exist', () => {
    expect(categoryOfTag('deal', DEFAULT_CATEGORIES.filter(category => category.slug !== 'coupon'))).toBeNull()
  })
})
