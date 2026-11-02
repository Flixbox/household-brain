/* oxlint-disable import/no-nodejs-modules, eslint/no-await-in-loop -- the supervisor writes its log and waits for each watcher to stop before rearming */
/** Codex lifecycle adapter. It supervises the existing watcher, never a second event classifier. */
import { openSync } from 'node:fs'
import { WATCHERS_DIR } from './watch-files'
import { hasText, isRecord } from './read'
import { withCodexSocket } from './codex-socket'

const hookTarget = async (): Promise<string> => {
  const input: unknown = JSON.parse(await Bun.stdin.text())
  if (!isRecord(input) || typeof input.session_id !== 'string' || input.cwd !== process.cwd()) {
    throw new Error('Invalid watcher session hook input')
  }
  return input.session_id
}

const target = process.argv.includes('--hook') ? await hookTarget() : process.env.CODEX_THREAD_ID
if (!hasText(target)) { throw new Error('Start the watcher in the intended Codex root thread') }
const directSettings = `${process.cwd()}/.claude/watcher.env`
const identity = `${process.cwd()}:${target}`
const stopFile = `${WATCHERS_DIR}/codex-${Bun.hash(identity).toString(36)}.stop`
if (process.argv.includes('--stop')) {
  await Bun.write(stopFile, 'stop')
  process.exit(0)
}
const settings = await Bun.file(directSettings).exists() ? directSettings : `${process.cwd()}/main/.claude/watcher.env`
if (!await Bun.file(settings).exists()) { process.exit(0) }
const checkout = settings.slice(0, -'/.claude/watcher.env'.length)

const checkTarget = async (): Promise<void> => withCodexSocket(async request => {
  const response = await request('thread/read', { includeTurns: false, threadId: target })
  const thread = isRecord(response) ? response.thread : null
  if (!isRecord(thread) || thread.id !== target || thread.cwd !== process.cwd() || thread.canAcceptDirectInput !== true) {
    throw new Error('Start the watcher in the intended Codex root thread; subagents do not accept direct input')
  }
})

const stopOnSessionEnd = (watcher: Bun.Subprocess) => setInterval(() => {
  Bun.file(stopFile).exists().then(stopped => {
    if (stopped) { watcher.kill(); process.exit(0) }
  }).catch(() => null)
}, 1000)

const watchOnce = async (): Promise<void> => {
  const watcher = Bun.spawn([process.execPath, `--env-file=${settings}`, `${import.meta.dir}/watch-project.ts`, '--follow'], {
    cwd: checkout,
    env: { ...process.env, CODEX_THREAD_ID: target, CODEX_WATCH_CWD: process.cwd(), CODEX_WATCH_THREAD: target, WATCHER_ID: `codex-${target}` },
    stderr: 'inherit', stdin: 'ignore', stdout: 'inherit',
  })
  const ended = stopOnSessionEnd(watcher)
  await watcher.exited
  clearInterval(ended)
}

const supervise = async (): Promise<never> => {
  // The same thread/project can start this from a hook and a skill, or after compaction. One wins.
  const port = 20_000 + Number(Bun.hash(`${process.cwd()}:${target}`) % 30_000n)
  const lock = Bun.listen({ exclusive: true, hostname: '127.0.0.1', port, socket: { data: socket => { socket.end() } } })
  process.on('exit', () => { lock.stop() })
  await Bun.file(stopFile).delete().catch(() => null)
  for (;;) {
    await watchOnce()
    process.stderr.write('project-watcher: watcher stopped; rearming\n')
    await Bun.sleep(1000)
  }
}

await checkTarget()
if (process.argv.includes('--supervise')) {
  await supervise()
} else {
  const logPath = `${WATCHERS_DIR}/codex-${Bun.hash(identity).toString(36)}.log`
  await Bun.write(logPath, '')
  const log = openSync(logPath, 'a', 0o600)
  const child = Bun.spawn([process.execPath, import.meta.path, '--supervise'], {
    detached: true, env: { ...process.env, CODEX_THREAD_ID: target }, stderr: log, stdin: 'ignore', stdout: log,
  })
  child.unref()
  process.stdout.write(`project-watcher: Codex supervisor started; diagnostics ${logPath}\n`)
}
