/* oxlint-disable import/no-nodejs-modules -- Bun has no rename of its own; node:fs/promises is built into Bun */
/**
 * What the project watcher remembers between runs, in plain files (the same ones the earlier bash
 * watcher kept, so either can take over from the other), and the lock that keeps a second watcher
 * from racing on them:
 *
 *   reported       one line per event already reported
 *   tracked        pull requests followed until their deploy or closing is reported
 *   issue-events   the new issues and issue comments already reported, by id (`issue #12`,
 *                  `issue-comment 345`); `issues`, keyed by their text, is no longer read (#247)
 *   main           the newest commit on main already reported
 *   open-issues    the open issues seen last round
 *   queued         the PRs in the merge queue, each with when it entered (#251)
 *   pr-<n>-seen    the comments and reviews of a PR already reported
 *   initialized    set after the first complete round: from then on, a PR is new, and so is all on it
 */
import { $ } from 'bun'
import { rename } from 'node:fs/promises'
import { REPO } from './watch-github'
import { ignoreFailure } from './read'

const home = process.env.HOME ?? '.'
const stateHome = process.env.XDG_STATE_HOME ?? `${home}/.local/state`
const DIR = process.env.STATE_DIR ?? `${stateHome}/watch-project/${REPO.replace('/', '_')}`

const stateFile = (name: string) => `${DIR}/${name}`

export const exists = async (name: string): Promise<boolean> => Bun.file(stateFile(name)).exists()

/**
 * Windows briefly locks a file just written (an antivirus scan, the search indexer: `EUNKNOWN` on
 * open, #231), which stopped the whole watcher. A state read or write tries again a few times first.
 */
const retried = async <Result>(work: () => Promise<Result>, tries = 5): Promise<Result> =>
  work().catch(async (error: unknown) => {
    if (tries <= 1) {
      throw error
    }
    await Bun.sleep(200)
    return retried(work, tries - 1)
  })

export const readLines = async (name: string): Promise<string[]> => retried(async () =>
  ((await exists(name)) ? (await Bun.file(stateFile(name)).text()).split('\n').filter(Boolean) : []))

/**
 * Written to a temporary file and renamed over the old one, so a write that fails halfway never leaves
 * a state file cut short. Bun.write creates the state directory on first use.
 */
const write = async (name: string, lines: readonly string[]): Promise<void> => retried(async () => {
  const draft = stateFile(`${name}.writing`)
  await Bun.write(draft, lines.length > 0 ? `${lines.join('\n')}\n` : '')
  await rename(draft, stateFile(name))
})

/** The last piece of work queued for each name. */
const queued = new Map<string, Promise<unknown>>()

/**
 * Work for the same name one piece after another (#240). The pollers and pull requests are checked at
 * once, and two read-then-write changes of one state file that overlap lose one's lines.
 */
export const oneAtATime = async <Result>(name: string, work: () => Promise<Result>): Promise<Result> => {
  const result = (queued.get(name) ?? Promise.resolve()).then(work)
  // The next piece waits only for this one to end; its failure reaches the caller through `result`.
  queued.set(name, result.catch(ignoreFailure))
  return result
}

export const writeLines = async (name: string, lines: readonly string[]): Promise<void> => oneAtATime(name, async () => write(name, lines))

/** Changes a state file's lines, with no other change to it in between. */
export const updateLines = async (name: string, change: (lines: string[]) => readonly string[]): Promise<void> =>
  oneAtATime(name, async () => write(name, change(await readLines(name))))

export const appendLines = async (name: string, lines: readonly string[]): Promise<void> => updateLines(name, old => [...old, ...lines])

/** Adds a line unless it is there already; true when it was added. */
export const addLine = async (name: string, line: string): Promise<boolean> => oneAtATime(name, async () => {
  const lines = await readLines(name)
  if (lines.includes(line)) {
    return false
  }
  await write(name, [...lines, line])
  return true
})

// LOCK_PORT: the local port the running watcher holds as its lock (#245); by default one from 20000
// to 29999 picked from the state directory, so each repository has its own. Set it if another
// program happens to listen on that port.
const LOCK_PORT = Number(process.env.LOCK_PORT ?? 20_000 + (Bun.hash.crc32(DIR) % 10_000))
// Port 0 would let the system pick any free port, so every watcher would get one: no lock at all.
if (!Number.isInteger(LOCK_PORT) || LOCK_PORT < 1 || LOCK_PORT > 65_535) {
  process.stderr.write('LOCK_PORT must be a port number from 1 to 65535\n')
  process.exit(64)
}

/**
 * One watcher per state directory; exits 75 when another one runs. The lock is a listening port on
 * this machine (#245): of watchers starting at once only one can open it, and the system frees it the
 * moment its watcher ends, however it ends, so no lock is ever left behind or taken over. A lock in
 * a file had both problems: a second watcher could slip in before the first wrote its id, and a dead
 * watcher's lock had to be taken over without two doing so at once.
 */
export const lock = async (): Promise<void> => {
  await $`mkdir -p ${DIR}`.quiet()
  try {
    // Anyone connecting is hung up on at once: the port only marks that a watcher runs.
    // Unref'd: the port never keeps the process alive by itself; the watcher's own loop does.
    // Exclusive: without it, some systems let a second process open the same port.
    Bun.listen({ exclusive: true, hostname: '127.0.0.1', port: LOCK_PORT, socket: { data: ignoreFailure, open: socket => { socket.end() } } }).unref()
  } catch {
    process.stderr.write(`another watcher already uses ${DIR} (it holds 127.0.0.1:${LOCK_PORT}; if another program does, set LOCK_PORT)\n`)
    process.exit(75)
  }
  // Stopped by a signal (a timeout, Ctrl-C): exit normally, so what a round found is still printed.
  process.on('SIGTERM', () => { process.exit(143) })
  process.on('SIGINT', () => { process.exit(130) })
}
