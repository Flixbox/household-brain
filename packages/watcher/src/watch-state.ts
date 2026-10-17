/* oxlint-disable import/no-nodejs-modules -- Bun has no rename, mkdir or synchronous read of its own; node:fs is built into Bun */
/**
 * What the project watcher remembers between runs, in plain files (the same ones the earlier bash
 * watcher kept, so either can take over from the other):
 *
 *   reported       one line per event already reported
 *   tracked        pull requests followed until their deploy or closing is reported
 *   issues         the first 80 characters of each issue line already reported
 *   main           the newest commit on main already reported
 *   open-issues    the open issues seen last round
 *   pr-<n>-seen    the comments and reviews of a PR already reported
 *   initialized    set after the first complete round: from then on, a PR is new, and so is all on it
 *   lock.d/pid     the running watcher's process id: two would race on these files
 *   lock.<pid>.*   a lock being made, or a dead watcher's being moved aside
 */
import { $ } from 'bun'
import { mkdir, rename, rm } from 'node:fs/promises'
import { readFileSync, rmSync } from 'node:fs'
import { REPO } from './watch-github'
import { ignoreFailure, isRecord } from './read'

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

const alive = (pid: number) => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

const LOCK = stateFile('lock.d')

const missing = (error: unknown) => isRecord(error) && error.code === 'ENOENT'

/**
 * The process id in a lock: null when there is none (no lock, or one an older watcher made without
 * one yet), 'unreadable' when it can't be read just now (Windows briefly locks a file, #231).
 */
const holder = async (lockDir = LOCK): Promise<number | null | 'unreadable'> =>
  Bun.file(`${lockDir}/pid`).text().then(text => {
    const pid = Number(text.trim())
    return Number.isInteger(pid) && pid > 0 ? pid : null
  }, (error: unknown) => (missing(error) ? null : 'unreadable'))

/**
 * Puts a lock holding this process's id in place in one step (#245): made aside, then renamed to the
 * lock's name, so the lock never exists without its holder's id. The rename fails while a lock is there.
 */
const publish = async (): Promise<boolean> => {
  const draft = stateFile(`lock.${process.pid}.making`)
  await rm(draft, { force: true, recursive: true })
  await mkdir(draft)
  await Bun.write(`${draft}/pid`, `${process.pid}\n`)
  const placed = await rename(draft, LOCK).then(() => true, () => false)
  await rm(draft, { force: true, recursive: true })
  return placed
}

/**
 * Moves a dead watcher's lock aside (#245). Of several watchers doing so at once, only one rename
 * succeeds. If what it moved is a live watcher's new lock instead, it puts it back.
 */
const takeOver = async (dead: number | null): Promise<void> => {
  const aside = stateFile(`lock.${process.pid}.dead`)
  // Read again right before: another watcher may have taken it over meanwhile and put its own there.
  if (await holder() !== dead || !await rename(LOCK, aside).then(() => true, () => false)) {
    return
  }
  const moved = await holder(aside)
  if (moved !== dead && typeof moved === 'number' && alive(moved)) {
    // If another lock took its place meanwhile, the live watcher finds at its next look that the
    // lock isn't its own and stops (`ownsLock`), so two never keep running.
    await rename(aside, LOCK).catch(ignoreFailure)
    return
  }
  await rm(aside, { force: true, recursive: true })
}

/** Takes the lock: 'taken', 'held' by a live watcher, or 'stuck' when it never got free. */
const take = async (tries = 25): Promise<'taken' | 'held' | 'stuck'> => {
  if (await publish()) {
    return 'taken'
  }
  const pid = await holder()
  if (typeof pid === 'number' && alive(pid)) {
    return 'held'
  }
  if (tries <= 1) {
    return 'stuck'
  }
  // Unreadable just now: look again in a moment. Otherwise the lock is a dead watcher's.
  await (pid === 'unreadable' ? Bun.sleep(200) : takeOver(pid))
  return take(tries - 1)
}

/**
 * Whether this watcher still holds the lock. One that lost it (a race the lock can't rule out, #245)
 * stops rather than report everything twice; a lock that can't be read just now still counts as its own.
 */
export const ownsLock = async (): Promise<boolean> => {
  const pid = await holder()
  return pid === 'unreadable' || pid === process.pid
}

/** Synchronously, for the exit handler: whether the lock is this process's own. */
const ownsLockNow = () => {
  try {
    return Number(readFileSync(`${LOCK}/pid`, 'utf8').trim()) === process.pid
  } catch {
    return false
  }
}

/** One watcher per state directory; exits 75 when another one runs. A lock left by a watcher that died is taken over. */
export const lock = async (): Promise<void> => {
  await $`mkdir -p ${DIR}`.quiet()
  const outcome = await take()
  if (outcome !== 'taken') {
    process.stderr.write(outcome === 'held' ? `another watcher already uses ${DIR}\n` : `the lock ${LOCK} stays taken: remove it if no watcher runs\n`)
    process.exit(75)
  }
  // Synchronously: an exit handler can't wait for anything. Only its own lock: never another watcher's.
  process.on('exit', () => { if (ownsLockNow()) { rmSync(LOCK, { force: true, recursive: true }) } })
  // Stopped by a signal (a timeout, Ctrl-C): exit normally, so the lock above is released too.
  process.on('SIGTERM', () => { process.exit(143) })
  process.on('SIGINT', () => { process.exit(130) })
}
