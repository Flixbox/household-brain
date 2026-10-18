import { describe, expect, it } from 'bun:test'
import { parseRef, refKey, refOf, refText } from './refs'

describe('parseRef', () => {
  it('reads an issue number, with or without #, and a full reference', () => {
    expect(parseRef('12', 'o/r')).toEqual({ number: 12, repo: 'o/r' })
    expect(parseRef(' #12 ', 'o/r')).toEqual({ number: 12, repo: 'o/r' })
    expect(parseRef('some-org/some.repo#7', 'o/r')).toEqual({ number: 7, repo: 'some-org/some.repo' })
  })

  it('refuses anything else, and a bare number without a repository', () => {
    expect(parseRef('#0', 'o/r')).toBeNull()
    expect(parseRef('twelve', 'o/r')).toBeNull()
    expect(parseRef('https://github.test/o/r/issues/12', 'o/r')).toBeNull()
    expect(parseRef('12', '')).toBeNull()
    expect(parseRef('12345678901234567890', 'o/r')).toBeNull()
    expect(parseRef('12', 'not a repo')).toBeNull()
  })
})

describe('refOf and refText', () => {
  it("reads an API answer's repository, and writes the full reference", () => {
    const ref = refOf({ number: 468, repository_url: 'https://api.github.test/repos/some-org/repo' })
    expect(ref).toEqual({ number: 468, repo: 'some-org/repo' })
    expect(ref ? refText(ref) : '').toBe('some-org/repo#468')
    expect(refOf({ number: '468', repository_url: 'x' })).toBeNull()
  })
})

describe('refKey', () => {
  it('names the same issue however its repository is written', () => {
    expect(refKey({ number: 1, repo: 'Some-Org/Repo' })).toBe(refKey({ number: 1, repo: 'some-org/repo' }))
  })
})
