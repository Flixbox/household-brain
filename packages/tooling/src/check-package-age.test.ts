/* oxlint-disable import/no-nodejs-modules -- a throwaway git repository in a temporary folder; node:fs, node:os and node:path are built into Bun */
// check-package-age.ts is a script, so it runs here as CI runs it: in a repository of its own, with
// the npm registry stubbed by a preload (#533).
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const SCRIPT = path.join(import.meta.dir, 'check-package-age.ts')
const AGE_SETTING = '[install]\nminimumReleaseAge = 172800\n'
const STUB = 'globalThis.fetch = async () => Response.json({ time: { "2.0.0": process.env.PUBLISHED } })\n'

let folder = ''
let stub = ''

const git = (...args: string[]) => {
  const result = Bun.spawnSync(['git', '-c', 'user.name=test', '-c', 'user.email=test@bot.test', '-c', 'commit.gpgsign=false', ...args], { cwd: folder })
  expect(result.stderr.toString()).not.toContain('fatal:')
}

const writeLock = (version: string) => {
  writeFileSync(path.join(folder, 'bun.lock'), JSON.stringify({ packages: { 'left-pad': [`left-pad@${version}`] } }))
}

const commitAll = () => {
  git('add', '-A')
  git('commit', '-q', '--allow-empty', '-m', 'commit')
}

const hoursAgo = (hours: number) => Temporal.Now.instant().subtract({ hours }).toString()

const check = (base: string, published = hoursAgo(1000)) => {
  const result = Bun.spawnSync([process.execPath, `--preload=${stub}`, SCRIPT, base], {
    cwd: folder,
    env: { ...process.env, PUBLISHED: published },
  })
  return { code: result.exitCode, out: result.stdout.toString() }
}

beforeEach(() => {
  folder = mkdtempSync(path.join(tmpdir(), 'check-package-age-'))
  stub = path.join(mkdtempSync(path.join(tmpdir(), 'check-package-age-stub-')), 'registry.ts')
  writeFileSync(stub, STUB)
  writeFileSync(path.join(folder, 'bunfig.toml'), AGE_SETTING)
  git('init', '-q')
})

afterEach(() => {
  rmSync(folder, { force: true, recursive: true })
  rmSync(path.dirname(stub), { force: true, recursive: true })
})

describe('check-package-age', () => {
  test('fails, naming the base and git\'s message, when the base does not resolve', () => {
    writeLock('1.0.0')
    commitAll()

    const { code, out } = check('no-such-ref')

    expect(code).toBe(1)
    expect(out).toContain('::error::')
    expect(out).toContain('no-such-ref')
    expect(out).toContain('fatal:')
  })

  test('fails when the base has no bun.lock', () => {
    commitAll()
    writeLock('1.0.0')

    const { code, out } = check('HEAD')

    expect(code).toBe(1)
    expect(out).toContain('::error::')
    expect(out).toContain('HEAD')
    expect(out).toContain('fatal:')
  })

  test('fails when bunfig.toml has no minimumReleaseAge', () => {
    writeLock('1.0.0')
    commitAll()
    writeLock('2.0.0')
    writeFileSync(path.join(folder, 'bunfig.toml'), '[install]\nexact = true\n')

    const { code, out } = check('HEAD')

    expect(code).toBe(1)
    expect(out).toContain('::error::')
    expect(out).toContain('minimumReleaseAge')
  })

  test('fails on an added version younger than the setting', () => {
    writeLock('1.0.0')
    commitAll()
    writeLock('2.0.0')

    const { code, out } = check('HEAD', hoursAgo(1))

    expect(code).toBe(1)
    expect(out).toContain('::error::left-pad@2.0.0')
  })

  test('passes an added version older than the setting', () => {
    writeLock('1.0.0')
    commitAll()
    writeLock('2.0.0')

    const { code, out } = check('HEAD')

    expect(code).toBe(0)
    expect(out).toContain('1 package versions to check against HEAD')
  })
})
