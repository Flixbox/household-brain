/* oxlint-disable import/no-nodejs-modules -- a temporary state folder for each started watcher module; node:fs and node:os are built into Bun */
// A MERGED_HOURS that Temporal can't go back by used to make every round fail in silence (#460):
// the watcher has to refuse it at the start instead. Each value gets its own process, as the check
// runs when the module loads.
import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'

const dirs: string[] = []
afterEach(() => { for (const dir of dirs.splice(0)) { rmSync(dir, { force: true, recursive: true }) } })

const load = (value: string | null) => {
  const home = mkdtempSync(`${tmpdir()}/merged-hours-`)
  dirs.push(home)
  const { MERGED_HOURS: _inherited, ...inherited } = process.env
  const env = { ...inherited, GH: 'false', OWNER: 'owner', REPO: 'owner/repo', XDG_STATE_HOME: home, ...value === null ? {} : { MERGED_HOURS: value } }
  const result = Bun.spawnSync([process.execPath, `${import.meta.dir}/watch-activity.ts`], { env })
  return { code: result.exitCode, stderr: result.stderr.toString() }
}

describe('MERGED_HOURS (#460)', () => {
  it.each(['', ' ', 'abc', '-1', '1.5', '1e30', '1e10', 'Infinity'])('stops the watcher at the start for %s', value => {
    expect(load(value)).toEqual({ code: 64, stderr: 'MERGED_HOURS must be a whole number from 0\n' })
  })

  it.each(['0', '3'])('accepts %s', value => {
    expect(load(value)).toEqual({ code: 0, stderr: '' })
  })

  it('accepts no value at all', () => {
    expect(load(null)).toEqual({ code: 0, stderr: '' })
  })
})
