import { describe, expect, it } from 'bun:test'
import { ownerWrite } from './owner-write-guard'

/** Room for a slow CI runner: the guard answers in well under this, and with quadratic work it takes many times as long. */
const boundMs = 3000
const testTimeoutMs = 120_000

const timed = (command: string) => {
  const started = performance.now()
  const found = ownerWrite(command)
  return { found, ms: performance.now() - started }
}

describe('ownerWrite answers long lines inside the hook timeout (#416)', () => {
  it('reads env followed by very many words quickly', () => {
    const words = Array.from({ length: 20_000 }, (_unused, nth) => `word${nth}`).join(' ')
    expect(timed(`env ${words}`).ms).toBeLessThan(boundMs)
  }, testTimeoutMs)

  it('reads a very long run of > quickly', () => {
    const { found, ms } = timed('>'.repeat(300_000))
    expect(found).toBeNull()
    expect(ms).toBeLessThan(boundMs)
  }, testTimeoutMs)

  it('reads a very long run of >& quickly', () => {
    expect(timed('>&'.repeat(150_000)).ms).toBeLessThan(boundMs)
  }, testTimeoutMs)
})

describe('ownerWrite refuses nested unsure arithmetic, quickly and without a crash (#496)', () => {
  const nested = (levels: number) => `${'$((a)'.repeat(levels)}1${')'.repeat(levels)}; gh issue close 1`

  it('refuses a few thousand characters of it inside the hook timeout', () => {
    const { found, ms } = timed(nested(1000))
    expect(found).not.toBeNull()
    expect(ms).toBeLessThan(boundMs)
  }, testTimeoutMs)

  it('refuses it nested too deep for the stack', () => {
    expect(timed(nested(12_000)).found).not.toBeNull()
  }, testTimeoutMs)

  it('refuses it with text between the levels, too deep for the stack', () => {
    expect(timed(`${'$((1)x '.repeat(17_000)}; gh issue close 1`).found).not.toBeNull()
  }, testTimeoutMs)
})
