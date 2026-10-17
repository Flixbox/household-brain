/* oxlint-disable import/no-nodejs-modules -- a temporary state directory for each test; node:fs/promises and node:os are built into Bun */
import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'

// Each watcher is its own process: the lock is between processes. REPO and GH are set so that loading
// the state module asks GitHub nothing (`false` answers every `gh` call with a failure).
const LOCKER = `import { lock } from '${import.meta.dir}/watch-state'; await lock(); console.log('locked'); await Bun.sleep(Number(process.env.HOLD_MS))`

const dirs: string[] = []
afterEach(async () => {
  await Promise.all(dirs.splice(0).map(async dir => rm(dir, { force: true, recursive: true })))
})

const stateDir = async () => {
  const dir = await mkdtemp(`${tmpdir()}/watch-lock-`)
  dirs.push(dir)
  return dir
}

const watcher = (dir: string, holdMs: number) => Bun.spawn([process.execPath, '-e', LOCKER], {
  env: { ...process.env, GH: 'false', HOLD_MS: String(holdMs), REPO: 'owner/repo', STATE_DIR: dir },
  stderr: 'ignore',
  stdout: 'pipe',
})

/** Waits for a watcher's first line: whether it took the lock, or ended without it. */
const startedLocked = async (process: ReturnType<typeof watcher>) => {
  const reader = process.stdout.getReader()
  const read = async (text: string): Promise<string> => {
    const { done, value } = await reader.read()
    const more = text + new TextDecoder().decode(value)
    return done || more.includes('\n') ? more : read(more)
  }
  const line = await read('')
  reader.releaseLock()
  return line.includes('locked')
}

describe('lock (#245)', () => {
  it('lets exactly one of several watchers starting at once run', async () => {
    const dir = await stateDir()
    const watchers = Array.from({ length: 6 }, () => watcher(dir, 3000))
    const outputs = await Promise.all(watchers.map(async one => new Response(one.stdout).text()))
    expect(outputs.filter(output => output.includes('locked'))).toHaveLength(1)
    expect((await Promise.all(watchers.map(async one => one.exited))).filter(code => code === 75)).toHaveLength(5)
  }, 30_000)

  it('is free again the moment its watcher is killed', async () => {
    const dir = await stateDir()
    const first = watcher(dir, 60_000)
    expect(await startedLocked(first)).toBe(true)
    first.kill('SIGKILL')
    await first.exited
    const second = watcher(dir, 0)
    expect(await new Response(second.stdout).text()).toContain('locked')
  }, 30_000)

  it('refuses a port that would lock nothing', async () => {
    const zero = Bun.spawn([process.execPath, '-e', LOCKER], { env: { ...process.env, GH: 'false', HOLD_MS: '0', LOCK_PORT: '0', REPO: 'owner/repo', STATE_DIR: await stateDir() }, stderr: 'ignore', stdout: 'ignore' })
    expect(await zero.exited).toBe(64)
  }, 30_000)

  it('is kept per state directory', async () => {
    const [one, other] = [watcher(await stateDir(), 3000), watcher(await stateDir(), 3000)]
    expect(await Promise.all([startedLocked(one), startedLocked(other)])).toEqual([true, true])
    one.kill()
    other.kill()
    await Promise.all([one.exited, other.exited])
  }, 30_000)
})
