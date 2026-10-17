/* oxlint-disable import/no-nodejs-modules -- a temporary state directory for each test; node:fs/promises and node:os are built into Bun */
import { afterEach, describe, expect, it } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'

// Each watcher is its own process: the lock is between processes. REPO and GH are set so that loading
// the state module asks GitHub nothing (`false` answers every `gh` call with a failure).
const LOCKER = `import { lock } from '${import.meta.dir}/watch-state'; await lock(); console.log('locked'); await Bun.sleep(1500)`

const dirs: string[] = []
afterEach(async () => {
  await Promise.all(dirs.splice(0).map(async dir => rm(dir, { force: true, recursive: true })))
})

const stateDir = async () => {
  const dir = await mkdtemp(`${tmpdir()}/watch-lock-`)
  dirs.push(dir)
  return dir
}

/** How many of `count` watchers started at once got the lock. */
const lockedAtOnce = async (dir: string, count: number) => {
  const watchers = Array.from({ length: count }, () => Bun.spawn([process.execPath, '-e', LOCKER], {
    env: { ...process.env, GH: 'false', REPO: 'owner/repo', STATE_DIR: dir },
    stderr: 'ignore',
    stdout: 'pipe',
  }))
  const outputs = await Promise.all(watchers.map(async watcher => new Response(watcher.stdout).text()))
  return outputs.filter(output => output.includes('locked')).length
}

describe('lock (#245)', () => {
  it('lets exactly one of several watchers starting at once run', async () => {
    expect(await lockedAtOnce(await stateDir(), 6)).toBe(1)
  }, 20_000)

  it("lets exactly one take over a dead watcher's lock", async () => {
    const dir = await stateDir()
    await mkdir(`${dir}/lock.d`)
    // A process id no live process has: Linux and macOS give out far smaller ones.
    await writeFile(`${dir}/lock.d/pid`, '4194304999\n')
    expect(await lockedAtOnce(dir, 6)).toBe(1)
  }, 20_000)

  it('takes over a lock whose watcher died before writing its process id', async () => {
    const dir = await stateDir()
    await mkdir(`${dir}/lock.d`)
    expect(await lockedAtOnce(dir, 3)).toBe(1)
  }, 20_000)
})
