/* oxlint-disable import/no-nodejs-modules -- a temporary state directory for each test; node:fs/promises and node:os are built into Bun */
import { afterEach, describe, expect, it } from 'bun:test'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'

// Each watcher is its own process: the lock is between processes. REPO and GH are set so that loading
// the state module asks GitHub nothing (`false` answers every `gh` call with a failure).
const STATE = `${import.meta.dir}/watch-state`
// Holds the lock and checks every moment that it still does, as the watcher does before each look.
const KEEPER = `import { lock, ownsLock } from '${STATE}'; await lock(); console.log('locked')
for (;;) { if (!await ownsLock()) { console.log('lost'); process.exit(75) } await Bun.sleep(100) }`

const dirs: string[] = []
afterEach(async () => {
  await Promise.all(dirs.splice(0).map(async dir => rm(dir, { force: true, recursive: true })))
})

const stateDir = async () => {
  const dir = await mkdtemp(`${tmpdir()}/watch-lock-`)
  dirs.push(dir)
  return dir
}

const watcher = (dir: string, script: string) => Bun.spawn([process.execPath, '-e', script], {
  env: { ...process.env, GH: 'false', REPO: 'owner/repo', STATE_DIR: dir },
  stderr: 'ignore',
  stdout: 'pipe',
})

/**
 * How many of `count` watchers started at once are still running a moment later. In a rare race two
 * get the lock, and the one that lost it stops at its next check, as the watcher does before each look.
 */
const runningAfterStart = async (dir: string, count: number) => {
  const keepers = Array.from({ length: count }, () => watcher(dir, KEEPER))
  await Bun.sleep(4000)
  const running = keepers.filter(keeper => keeper.exitCode === null).length
  for (const keeper of keepers) {
    keeper.kill()
  }
  await Promise.all(keepers.map(async keeper => keeper.exited))
  return running
}

/** Waits until the lock holds a process id. */
const locked = async (dir: string, tries = 100): Promise<void> => {
  if (tries > 0 && !await Bun.file(`${dir}/lock.d/pid`).exists()) {
    await Bun.sleep(50)
    await locked(dir, tries - 1)
  }
}

describe('lock (#245)', () => {
  it('lets exactly one of several watchers starting at once run', async () => {
    expect(await runningAfterStart(await stateDir(), 6)).toBe(1)
  }, 30_000)

  it("lets exactly one take over a dead watcher's lock", async () => {
    const dir = await stateDir()
    await mkdir(`${dir}/lock.d`)
    // A process id no live process has: Linux and macOS give out far smaller ones.
    await writeFile(`${dir}/lock.d/pid`, '4194304999\n')
    expect(await runningAfterStart(dir, 6)).toBe(1)
  }, 30_000)

  it('takes over a lock without a process id', async () => {
    const dir = await stateDir()
    await mkdir(`${dir}/lock.d`)
    await writeFile(`${dir}/lock.d/note`, 'left by an older watcher\n')
    expect(await runningAfterStart(dir, 3)).toBe(1)
  }, 30_000)

  it("stops a watcher whose lock became another's, and leaves that lock alone", async () => {
    const dir = await stateDir()
    const keeper = watcher(dir, KEEPER)
    const output = new Response(keeper.stdout).text()
    await locked(dir)
    // This test's own process, alive, now holds the lock.
    await writeFile(`${dir}/lock.d/pid`, `${process.pid}\n`)
    expect(await keeper.exited).toBe(75)
    expect(await output).toContain('lost')
    expect((await readFile(`${dir}/lock.d/pid`, 'utf8')).trim()).toBe(String(process.pid))
  }, 30_000)
})
