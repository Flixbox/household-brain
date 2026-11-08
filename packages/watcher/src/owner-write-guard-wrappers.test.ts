import { describe, expect, it } from 'bun:test'
import { ownerWrite } from './owner-write-guard'

/** Room for a slow CI runner: the guard answers in well under this, and unbounded it takes many times as long. */
const boundMs = 3000
const testTimeoutMs = 120_000

const timed = (command: string) => {
  const started = performance.now()
  const found = ownerWrite(command)
  return { found, ms: performance.now() - started }
}

const files = (count: number) => Array.from({ length: count }, (_unused, nth) => `packages/watcher/src/some-module-${nth}.ts`).join(' ')

describe('ownerWrite behind a wrapper stays within the work budget (#434)', () => {
  it('refuses a wrapper with very many words, quickly', () => {
    const { found, ms } = timed(`env ${'a '.repeat(8000)}`)
    expect(found).not.toBeNull()
    expect(ms).toBeLessThan(boundMs)
  }, testTimeoutMs)

  it('refuses an interpreter repeated behind a wrapper, whose programs would each be read', () => {
    const awk = `awk ${'x'.repeat(300)} `
    const { found, ms } = timed(`env ${awk.repeat(300)}`)
    expect(found).not.toBeNull()
    expect(ms).toBeLessThan(boundMs)
  }, testTimeoutMs)

  it('refuses gh repeated behind a wrapper, whose arguments would each be read', () => {
    const gh = `gh api graphql -f query=${'x'.repeat(2000)} `
    const { found, ms } = timed(`env ${gh.repeat(200)}`)
    expect(found).not.toBeNull()
    expect(ms).toBeLessThan(boundMs)
  }, testTimeoutMs)

  it('lets a long ordinary command behind a wrapper run', () => {
    expect(ownerWrite(`timeout 60 eslint ${files(3000)}`)).toBeNull()
    expect(ownerWrite(`sudo -u x nice -n 10 gh pr view 1 ${files(500)}`)).toBeNull()
  }, testTimeoutMs)

  it('still finds a write at the end of a long command behind a wrapper', () => {
    expect(ownerWrite(`env ${files(500)} gh issue close 1`)).not.toBeNull()
  }, testTimeoutMs)
})
