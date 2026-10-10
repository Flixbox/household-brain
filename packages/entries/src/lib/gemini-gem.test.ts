import { describe, expect, it } from 'vitest'
import { DEFAULT_CATEGORIES } from './categories'
import { INTERVALS } from './items/interval'
import gem from './gemini-gem.md?raw'

/** The instructions pasted into the Gemini Gem: the fenced block of `gemini-gem.md` (#119). */
const instructions = gem.match(/```text\n(?<text>[\s\S]*?)```/u)?.groups?.text ?? ''

const listed = (pattern: RegExp) => (instructions.match(pattern)?.groups?.list ?? '').split(', ').toSorted()

describe('the Gemini Gem instructions', () => {
  it('offer exactly the default categories', () => {
    expect(listed(/^- category: exactly one of (?<list>[a-z, -]+)\. /mu)).toEqual(DEFAULT_CATEGORIES.map(category => category.slug).toSorted())
  })

  it('offer exactly the price intervals', () => {
    expect(listed(/^- interval: for a recurring price one of (?<list>[a-z, -]+); null for a one-off\.$/mu)).toEqual(INTERVALS.map(interval => interval.value).toSorted())
  })
})
