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
  it('refuses very many words behind a wrapper that are each read further, quickly', () => {
    const { found, ms } = timed(`env ${'sh '.repeat(8000)}`)
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

  it('lets a file list too long to charge per start run behind a wrapper, quickly (#456)', () => {
    const { found, ms } = timed(`xargs -n1 ls ${files(6000)}`)
    expect(found).toBeNull()
    expect(ms).toBeLessThan(boundMs)
  }, testTimeoutMs)

  // One line per kind of command the guard reads further: a kind left out of what a wrapper's starts are kept for would go unseen here (#456).
  it.each([
    'gh issue close 1',
    'xargs gh',
    "bash -c 'gh issue close 1'",
    "eval 'gh issue close 1'",
    "env -S 'gh issue close 1'",
    "flock x -c 'gh issue close 1'",
    "script -c 'gh issue close 1'",
    "sh <<< 'gh issue close 1'",
    "source /dev/stdin <<< 'gh issue close 1'",
    ". /dev/stdin <<< 'gh issue close 1'",
    "awk 'gh issue close 1'",
    "python3 -c 'gh issue close 1'",
    "perl -e 'gh issue close 1'",
    "ruby -e 'gh issue close 1'",
    "node -e 'gh issue close 1'",
    "make -f - <<< 'gh issue close 1'",
  ])('still finds %s after a file list behind a wrapper', command => {
    expect(ownerWrite(`timeout 60 ${files(200)} ${command}`)).not.toBeNull()
  }, testTimeoutMs)

  it('still finds a write at the end of a long command behind a wrapper', () => {
    expect(ownerWrite(`env ${files(500)} gh issue close 1`)).not.toBeNull()
  }, testTimeoutMs)
})

describe('ownerWrite and a variable behind a wrapper (#436)', () => {
  it.each([
    'timeout 5 agent-gh issue close "$N"',
    'timeout 5 make "$X"',
    'flock x agent-gh issue close "$N"',
    'flock x echo "$X"',
    'timeout "$SECONDS_LEFT" agent-gh issue close "$N"',
    'sudo -u x agent-gh issue close "$N"',
    'env A=1 agent-gh issue close "$N"',
    'nohup timeout 5 agent-gh issue close "$N" 2>/dev/null',
  ])('lets %s run: the variable is an argument', command => {
    expect(ownerWrite(command)).toBeNull()
  })

  it.each([
    'timeout 5 "$CMD"',
    'timeout -k 5 10 "$CMD"',
    'flock x "$CMD"',
    'sudo -u x "$CMD"',
    'env A=1 "$CMD"',
    'nice "$CMD"',
    'sudo timeout 5 "$CMD"',
    'nohup sudo -u x nice -n 10 "$CMD"',
    'timeout "$OPTION" 5 "$CMD"',
    'timeout 5 2>/dev/null "$CMD"',
    'timeout 5 "$GH" issue close 1',
    'env -i timeout 5 "$CMD"',
    'env -- timeout 5 "$CMD"',
    'env -S timeout 5 "$CMD"',
    'sudo -n timeout 5 "$CMD"',
    'sudo -uroot timeout 5 "$CMD"',
    'sudo -n flock x "$CMD"',
    'timeout -k5 10 flock x "$CMD"',
    'flock -n x timeout 5 "$CMD"',
    'taskset -c 1 timeout 5 "$CMD"',
    'coproc timeout 5 "$CMD"',
    'nohup 2>/dev/null timeout 5 "$CMD"',
  ])('still refuses %s: the variable may be the command', command => {
    expect(ownerWrite(command)).not.toBeNull()
  })

  it.each([
    'timeout 5 gh issue close "$N"',
    'sudo -u x gh issue close "$N"',
    'timeout 5 agent-gh issue view 1 && gh issue close "$N"',
  ])('still refuses %s: a real gh write', command => {
    expect(ownerWrite(command)).not.toBeNull()
  })
})
