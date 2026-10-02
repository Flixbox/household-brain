import { describe, expect, it } from 'vitest'
import { matchesSearch } from './search'

const item = { amount: '9.99', code: 'SUMMER25', notes: 'Only online', title: 'Café Müller', url: 'https://shop.household-brain.test' }

describe('matchesSearch', () => {
  it('finds words in any field, ignoring case and accents', () => {
    expect(matchesSearch(item, 'cafe')).toBe(true)
    expect(matchesSearch(item, 'MULLER')).toBe(true)
    expect(matchesSearch(item, 'summer25')).toBe(true)
    expect(matchesSearch(item, 'online')).toBe(true)
    expect(matchesSearch(item, 'household-brain')).toBe(true)
    expect(matchesSearch(item, '9.99')).toBe(true)
    expect(matchesSearch({ ...item, title: 'Straße' }, 'strasse')).toBe(true)
  })

  it('needs every word to match', () => {
    expect(matchesSearch(item, 'café summer')).toBe(true)
    expect(matchesSearch(item, 'café winter')).toBe(false)
  })

  it('matches everything for an empty query', () => {
    expect(matchesSearch(item, '   ')).toBe(true)
  })
})
