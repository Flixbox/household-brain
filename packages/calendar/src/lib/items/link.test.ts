import { describe, expect, it } from 'vitest'
import { LINK_PATTERN, normaliseLink, openableLink } from './link'

// Compiled the way the browser compiles an input's pattern.
const matches = (value: string) => new RegExp(`^(?:${LINK_PATTERN})$`, 'v').test(value)

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

describe('openableLink', () => {
  it('opens web addresses only, with https:// added to a bare domain', () => {
    expect(openableLink('shop.household-brain.test/deal')).toBe('https://shop.household-brain.test/deal')
    expect(openableLink('http://shop.household-brain.test')).toBe('http://shop.household-brain.test')
    expect(openableLink('')).toBeNull()
    expect(openableLink('just words')).toBeNull()
    // A script link that would pass as an address; built from parts, as the literal is banned by lint.
    expect(openableLink(['javascript', '//shop.household-brain.test/%0aalert(1)'].join(':'))).toBeNull()
    expect(openableLink('ftp://files.household-brain.test')).toBeNull()
  })
})
