/* oxlint-disable import/no-nodejs-modules -- a temporary state folder for each loaded module; node:fs and node:os are built into Bun */
// GH_TIMEOUT_SECONDS was never checked and a blank GH_SHARE_SECONDS passed (#519): the watcher has to
// refuse them at the start instead. Each value gets its own process, as the checks run when the
// module loads.
import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'

const dirs: string[] = []
afterEach(() => { for (const dir of dirs.splice(0)) { rmSync(dir, { force: true, recursive: true }) } })

const load = (name: string, value: string | null) => {
  const home = mkdtempSync(`${tmpdir()}/gh-settings-`)
  dirs.push(home)
  const { GH_SHARE_SECONDS: _share, GH_TIMEOUT_SECONDS: _timeout, ...inherited } = process.env
  const env = { ...inherited, XDG_STATE_HOME: home, ...value === null ? {} : { [name]: value } }
  const result = Bun.spawnSync([process.execPath, `${import.meta.dir}/watch-gh.ts`], { env })
  return { code: result.exitCode, stderr: result.stderr.toString() }
}

describe('GH_TIMEOUT_SECONDS (#519)', () => {
  // 0 and a blank mean no limit to Bun.spawn; a fraction of a millisecond, a negative number or one
  // too big makes it throw, and from 2^31 ms it ends the call at once.
  it.each(['', ' ', 'abc', '0', '-1', '1.5', 'Infinity', '3601'])('stops the watcher at the start for %j', value => {
    expect(load('GH_TIMEOUT_SECONDS', value)).toEqual({ code: 64, stderr: 'GH_TIMEOUT_SECONDS must be a whole number from 1 to 3600\n' })
  })

  it.each(['1', '30', '3600'])('accepts %s', value => {
    expect(load('GH_TIMEOUT_SECONDS', value)).toEqual({ code: 0, stderr: '' })
  })

  it('accepts no value at all', () => {
    expect(load('GH_TIMEOUT_SECONDS', null)).toEqual({ code: 0, stderr: '' })
  })
})

describe('GH_SHARE_SECONDS (#519)', () => {
  it.each(['', ' ', 'abc', '-1', '3601'])('stops the watcher at the start for %j', value => {
    expect(load('GH_SHARE_SECONDS', value)).toEqual({ code: 64, stderr: 'GH_SHARE_SECONDS must be a number from 0 to 3600\n' })
  })

  it.each(['0', '20', '3600'])('accepts %s', value => {
    expect(load('GH_SHARE_SECONDS', value)).toEqual({ code: 0, stderr: '' })
  })

  it('accepts no value at all', () => {
    expect(load('GH_SHARE_SECONDS', null)).toEqual({ code: 0, stderr: '' })
  })
})
