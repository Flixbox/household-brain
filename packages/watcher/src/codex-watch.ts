/* oxlint-disable import/no-nodejs-modules, eslint/no-await-in-loop -- the supervisor writes its log, waits for each watcher to stop before rearming, and retries its one report in turn */
/** Codex lifecycle adapter. It supervises the existing watcher, never a second event classifier. */
import { SUBSCRIPTIONS_COMPLETE, selectionKey } from './watch-subscription-model'
import { openSync } from 'node:fs'
import { WATCHERS_DIR } from './watch-files'
import { hasText, isRecord } from './read'
import { type Notification, notifyCodex } from './codex-notify'
import { withCodexSocket } from './codex-socket'

// The watcher's exit for a setting it refuses at the start (#527): the same settings fail the same way.
const BAD_SETTING = 64
const ERROR_TAIL = 2000
const REPORT_ATTEMPTS = 24
const REPORT_PAUSE_MS = 5000

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
const selection = selectionKey(process.env.WATCHER_SUBSCRIPTIONS ?? '')
const baseIdentity = `${process.cwd()}:${target}`
const identity = selection === '' ? baseIdentity : `${baseIdentity}:${selection}`
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

/** Passes the watcher's stderr on to the log, and keeps its end for a report. */
const followErrors = (watcher: Bun.Subprocess<'ignore', 'inherit', 'pipe'>) => {
  const seen = { tail: '' }
  const done = (async () => {
    for await (const chunk of watcher.stderr.pipeThrough(new TextDecoderStream())) {
      process.stderr.write(chunk)
      seen.tail = `${seen.tail}${chunk}`.slice(-ERROR_TAIL)
    }
  })().catch(() => null)
  return { done, seen }
}

const watchOnce = async (): Promise<{ code: number, errors: string }> => {
  const watcher = Bun.spawn([process.execPath, `--env-file=${settings}`, `${import.meta.dir}/watch-project.ts`, '--follow'], {
    cwd: checkout,
    env: { ...process.env, CODEX_THREAD_ID: target, CODEX_WATCH_CWD: process.cwd(), CODEX_WATCH_THREAD: target, WATCHER_ID: `codex-${target}` },
    stderr: 'pipe', stdin: 'ignore', stdout: 'inherit',
  })
  const errors = followErrors(watcher)
  const ended = stopOnSessionEnd(watcher)
  const code = await watcher.exited
  clearInterval(ended)
  // Bounded: something the watcher started may hold the pipe open after the watcher has gone.
  await Promise.race([errors.done, Bun.sleep(1000)])
  return { code, errors: errors.seen.tail.trim() }
}

const deliverReport = async (event: Notification): Promise<boolean> => withCodexSocket(async request => notifyCodex(request, { cwd: process.cwd(), threadId: target }, event)).then(() => true, () => false)

/** The session is told once; a thread that isn't ready yet gets a little while before only the log has it. */
const reportStopped = async (errors: string): Promise<void> => {
  const event = { id: crypto.randomUUID(), lines: [`WATCHER_STOPPED: the watcher refused its settings and isn't being rearmed. Fix them, then start the Codex adapter again. Its error: ${errors}`] }
  for (let attempt = 0; attempt < REPORT_ATTEMPTS; attempt += 1) {
    // A session that ended can't be told, and the lock must not outlive it.
    if (await Bun.file(stopFile).exists() || await deliverReport(event)) { return }
    await Bun.sleep(REPORT_PAUSE_MS)
  }
  process.stderr.write('project-watcher: could not tell the session the watcher stopped\n')
}

const afterWatcher = async ({ code, errors }: { code: number, errors: string }): Promise<void> => {
  if (code === SUBSCRIPTIONS_COMPLETE) { process.exit(0) }
  if (code === BAD_SETTING) {
    process.stderr.write('project-watcher: bad setting; not rearming\n')
    await reportStopped(errors)
    process.exit(BAD_SETTING)
  }
  process.stderr.write('project-watcher: watcher stopped; rearming\n')
  await Bun.sleep(1000)
}

const supervise = async (): Promise<never> => {
  // The same thread/project can start this from a hook and a skill, or after compaction. One wins.
  const port = 20_000 + Number(Bun.hash(identity) % 30_000n)
  const lock = Bun.listen({ exclusive: true, hostname: '127.0.0.1', port, socket: { data: socket => { socket.end() } } })
  process.on('exit', () => { lock.stop() })
  await Bun.file(stopFile).delete().catch(() => null)
  for (;;) {
    await afterWatcher(await watchOnce())
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
