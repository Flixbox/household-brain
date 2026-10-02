import { describe, expect, it } from 'vitest'
import { DEFAULT_CATEGORIES, RETIRED_DEFAULTS, missingDefaults, visibleCategories } from './categories'

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
