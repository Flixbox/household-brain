import { describe, expect, it } from 'vitest'
import { DEFAULT_CATEGORIES } from './categories'
import { NO_CATEGORY_COLOR, categoryColor } from './category-colors'

describe('categoryColor', () => {
  it('matches Google Calendar event colours', () => {
    expect(categoryColor('6')).toBe('#f4511e')
    expect(categoryColor('3')).toBe('#8e24aa')
  })

  it('gives every default category its own colour', () => {
    const colors = DEFAULT_CATEGORIES.map(category => categoryColor(category.colorId))
    expect(new Set(colors).size).toBe(DEFAULT_CATEGORIES.length)
  })

  it('falls back to graphite for unknown ids', () => {
    expect(categoryColor('99')).toBe(NO_CATEGORY_COLOR)
  })
})
