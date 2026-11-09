/* oxlint-disable import/no-nodejs-modules -- a temporary project and Codex home for each supervisor; node:fs and node:os are built into Bun */
// A bad setting makes the watcher exit 64 at the start, so rearming it could never help (#527):
// the supervisor has to stop and tell the session, because its log reaches nobody.
import { afterEach, describe, expect, it } from 'bun:test'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'

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
const fakeDaemon = (home: string, cwd: string): string[] => {
  const delivered: string[] = []
  const results: Record<string, (params: { input?: { text: string }[] }) => unknown> = {
    initialize: () => ({}),
    'thread/read': () => ({ thread: { canAcceptDirectInput: true, cwd, id: THREAD, status: { type: 'idle' } } }),
    'turn/start': params => { delivered.push(params.input?.[0]?.text ?? ''); return {} },
  }
  mkdirSync(`${home}/app-server-control`)
  const server = Bun.serve({
    fetch: (request, self) => self.upgrade(request) ? new Response() : new Response('upgrade', { status: 400 }),
    unix: `${home}/app-server-control/app-server-control.sock`,
    websocket: {
      message: (socket, text) => {
        const { id, method, params } = JSON.parse(String(text)) as { id?: number, method: string, params: { input?: { text: string }[] } }
        if (typeof id === 'number') { socket.send(JSON.stringify({ id, result: results[method]?.(params) ?? {} })) }
      },
    },
  })
  cleanups.push(() => { server.stop(true).catch(() => null) })
  return delivered
}

const startSupervisor = (cwd: string, home: string) => {
  mkdirSync(`${cwd}/.claude`)
  writeFileSync(`${cwd}/.claude/watcher.env`, 'GH=false\nGH_PARALLEL=0\nOWNER=owner\nREPO=owner/repo\n')
  const { GH_PARALLEL: _inherited, ...inherited } = process.env
  const supervisor = Bun.spawn([process.execPath, `${import.meta.dir}/codex-watch.ts`, '--supervise'], {
    cwd,
    env: { ...inherited, CODEX_HOME: home, CODEX_THREAD_ID: THREAD, WATCHER_SUBSCRIPTIONS: '', XDG_STATE_HOME: home },
    stderr: 'ignore', stdin: 'ignore', stdout: 'ignore',
  })
  cleanups.push(() => { supervisor.kill() })
  return supervisor
}

describe('the Codex supervisor on a bad setting (#527)', () => {
  it('stops rearming and tells the session what is wrong', async () => {
    const [cwd, home] = [tempDir(), tempDir()]
    const delivered = fakeDaemon(home, cwd)
    const supervisor = startSupervisor(cwd, home)
    const ended = await Promise.race([supervisor.exited, Bun.sleep(WAIT_MS).then(() => 'still rearming')])
    expect(ended).toBe(64)
    expect(delivered).toHaveLength(1)
    expect(delivered[0]).toContain('GH_PARALLEL must be a whole number from 1')
  }, WAIT_MS * 2)
})
