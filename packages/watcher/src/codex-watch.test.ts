/* oxlint-disable import/no-nodejs-modules, eslint/no-await-in-loop -- a temporary project and Codex home for each supervisor, built into Bun; the test polls until the supervisor is retrying */
// A bad setting makes the watcher exit 64 at the start, so rearming it could never help (#527):
// the supervisor has to stop and tell the session, because its log reaches nobody.
import { afterEach, describe, expect, it } from 'bun:test'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { isRecord } from './read'

const THREAD = 'thread-under-test'
const WAIT_MS = 8000

const cleanups: (() => void)[] = []
afterEach(() => { for (const cleanup of cleanups.splice(0)) { cleanup() } })

const tempDir = (): string => {
  const dir = realpathSync(mkdtempSync(`${tmpdir()}/codex-watch-`))
  cleanups.push(() => { rmSync(dir, { force: true, recursive: true }) })
  return dir
}

/** The local Codex daemon, as far as the supervisor talks to it. */
const fakeDaemon = (home: string, cwd: string, status: string) => {
  const delivered: string[] = []
  const reads: string[] = []
  const results: Record<string, (params: unknown) => unknown> = {
    initialize: () => ({}),
    'thread/read': () => { reads.push(status); return { thread: { canAcceptDirectInput: true, cwd, id: THREAD, status: { type: status } } } },
    'turn/start': params => { delivered.push(JSON.stringify(params)); return {} },
  }
  mkdirSync(`${home}/app-server-control`)
  const server = Bun.serve({
    fetch: (request, self) => self.upgrade(request) ? new Response() : new Response('upgrade', { status: 400 }),
    unix: `${home}/app-server-control/app-server-control.sock`,
    websocket: {
      message: (socket, text) => {
        const message: unknown = JSON.parse(String(text))
        if (isRecord(message) && typeof message.id === 'number') {
          socket.send(JSON.stringify({ id: message.id, result: results[String(message.method)]?.(message.params) ?? {} }))
        }
      },
    },
  })
  cleanups.push(() => { server.stop(true).catch(() => null) })
  return { delivered, reads }
}

const within = async (ending: Promise<number>) => Promise.race([ending, Bun.sleep(WAIT_MS).then(() => 'still running')])

const untilRetrying = async (reads: string[]): Promise<void> => {
  const deadline = Bun.nanoseconds() + WAIT_MS * 1_000_000
  while (reads.length < 2 && Bun.nanoseconds() < deadline) { await Bun.sleep(50) }
}

const supervisorEnv = (home: string) => {
  const { GH_PARALLEL: _inherited, ...inherited } = process.env
  return { ...inherited, CODEX_HOME: home, CODEX_THREAD_ID: THREAD, WATCHER_SUBSCRIPTIONS: '', XDG_STATE_HOME: home }
}

const startSupervisor = (cwd: string, home: string) => {
  mkdirSync(`${cwd}/.claude`)
  writeFileSync(`${cwd}/.claude/watcher.env`, 'GH=false\nGH_PARALLEL=0\nOWNER=owner\nREPO=owner/repo\n')
  const supervisor = Bun.spawn([process.execPath, `${import.meta.dir}/codex-watch.ts`, '--supervise'], { cwd, env: supervisorEnv(home), stderr: 'ignore', stdin: 'ignore', stdout: 'ignore' })
  cleanups.push(() => { supervisor.kill() })
  return supervisor
}

describe('the Codex supervisor on a bad setting (#527)', () => {
  it('stops rearming and tells the session what is wrong', async () => {
    const [cwd, home] = [tempDir(), tempDir()]
    const { delivered } = fakeDaemon(home, cwd, 'idle')
    const supervisor = startSupervisor(cwd, home)
    expect(await within(supervisor.exited)).toBe(64)
    expect(delivered).toHaveLength(1)
    expect(delivered[0]).toContain('GH_PARALLEL must be a whole number from 1')
  }, WAIT_MS * 2)

  it('gives up its report as soon as the session has ended', async () => {
    const [cwd, home] = [tempDir(), tempDir()]
    // Never ready, so the report keeps being retried.
    const { reads } = fakeDaemon(home, cwd, 'notLoaded')
    const supervisor = startSupervisor(cwd, home)
    await untilRetrying(reads)
    Bun.spawnSync([process.execPath, `${import.meta.dir}/codex-watch.ts`, '--stop'], { cwd, env: supervisorEnv(home) })
    expect(await within(supervisor.exited)).toBe(64)
  }, WAIT_MS * 3)
})
