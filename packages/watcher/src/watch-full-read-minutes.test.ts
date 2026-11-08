// A blank FULL_READ_MINUTES used to read as 0, so every PR was read in full on every look (#465): the
// watcher has to refuse it at the start instead. Each value gets its own process, as the check runs
// when the module loads.
import { describe, expect, it } from 'bun:test'

const load = (value: string | null) => {
  const { FULL_READ_MINUTES: _inherited, ...inherited } = process.env
  const env = { ...inherited, ...value === null ? {} : { FULL_READ_MINUTES: value } }
  const result = Bun.spawnSync([process.execPath, `${import.meta.dir}/watch-change-due.ts`], { env })
  return { code: result.exitCode, stderr: result.stderr.toString() }
}

describe('FULL_READ_MINUTES (#465)', () => {
  it.each(['', ' ', 'abc', '-1', 'Infinity'])('stops the watcher at the start for %j', value => {
    expect(load(value)).toEqual({ code: 64, stderr: 'FULL_READ_MINUTES must be a number from 0\n' })
  })

  it.each(['0', '10', '1.5'])('accepts %s', value => {
    expect(load(value)).toEqual({ code: 0, stderr: '' })
  })

  it('accepts no value at all', () => {
    expect(load(null)).toEqual({ code: 0, stderr: '' })
  })
})
