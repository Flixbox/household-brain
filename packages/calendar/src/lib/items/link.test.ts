import { describe, expect, it } from 'vitest'
import { LINK_PATTERN, normaliseLink } from './link'

const matches = (value: string) => new RegExp(`^(?:${LINK_PATTERN})$`, 'u').test(value)

describe('normaliseLink', () => {
  it('adds https:// to a bare domain', () => {
    expect(normaliseLink('example.de')).toBe('https://example.de')
    expect(normaliseLink('  www.shop.example/deal?id=1 ')).toBe('https://www.shop.example/deal?id=1')
  })

  it('keeps a full address and an empty field as they are', () => {
    expect(normaliseLink('http://example.de')).toBe('http://example.de')
    expect(normaliseLink('https://example.de/x')).toBe('https://example.de/x')
    expect(normaliseLink('  ')).toBe('')
  })
})

describe('LINK_PATTERN', () => {
  it('accepts domains with or without a scheme, and rejects text that is no address', () => {
    expect(matches('example.de')).toBe(true)
    expect(matches('https://example.de/a b')).toBe(false)
    expect(matches('https://example.de/deal')).toBe(true)
    expect(matches('just words')).toBe(false)
    expect(matches('nodot')).toBe(false)
  })
})
