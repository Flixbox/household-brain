import { describe, expect, it } from 'bun:test'
import { bodyLines } from './watch-text'

const URL = 'https://github.test/o/r/issues/3#issuecomment-9'

describe('bodyLines (#255)', () => {
  it("gives the owner's comment whole, line for line, indented under its event", () => {
    const body = `do this first.\n\nafter this is implemented, ${'go on '.repeat(80)}\r\nand last this`
    const lines = bodyLines(body, { url: URL, whole: true })
    expect(lines[0]).toBe('    do this first.')
    expect(lines[1]).toBe('')
    expect(lines.at(-1)).toBe('    and last this')
    expect(lines.join('\n')).toContain('go on '.repeat(80).trim())
  })

  it("cuts anyone else's long comment, and says so and where the rest is", () => {
    const [line = ''] = bodyLines('x'.repeat(350), { url: URL, whole: false })
    expect(line).toBe(`    ${'x'.repeat(300)} … [50 more characters: ${URL}]`)
    expect(bodyLines('short\nreply', { url: URL, whole: false })).toEqual(['    short reply'])
  })

  it('gives nothing for an empty body, and indents as asked', () => {
    expect(bodyLines('  ', { url: URL, whole: true })).toEqual([])
    expect(bodyLines('a', { indent: '      ', url: URL, whole: true })).toEqual(['      a'])
  })
})
