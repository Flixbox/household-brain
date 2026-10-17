/* oxlint-disable import/no-nodejs-modules -- Bun has no rename or atomic mkdir of its own; node:fs/promises is built into Bun */
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
 *   lock.d/taking-over  made by the one watcher taking over a dead watcher's lock
 */
import { $ } from 'bun'
import { mkdir, rename, rm } from 'node:fs/promises'
import { REPO } from './watch-github'
import { hasText, ignoreFailure } from './read'

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

/** Makes a directory; false when it is there already. Atomic: of two at once, only one makes it. */
const made = async (path: string): Promise<boolean> => mkdir(path).then(() => true, () => false)

/**
 * The lock holder's process id, or null. A watcher that has just made the lock writes its id a
 * moment later (#245), so a missing one is read again for a while before it counts as missing.
 */
const holder = async (tries = 10): Promise<number | null> => {
  const [pid] = await readLines('lock.d/pid').catch((): string[] => [])
  if (hasText(pid) || tries <= 1) {
    return hasText(pid) ? Number(pid) : null
  }
  await Bun.sleep(200)
  return holder(tries - 1)
}

const liveHolder = async () => {
  const pid = await holder()
  return pid !== null && alive(pid)
}

/**
 * A dead watcher's lock (#245): of several taking it over, only the one that makes `taking-over`
 * inside it does. That one looks again first: the lock it holds may be a live watcher's new one.
 */
const takeOver = async (): Promise<void> => {
  if (!await made(`${LOCK}/taking-over`)) {
    // Another watcher is taking it over: wait, then look at the lock it leaves.
    await Bun.sleep(200)
    return
  }
  await rm(await liveHolder() ? `${LOCK}/taking-over` : LOCK, { force: true, recursive: true })
}

/** Takes the lock: 'taken', 'held' by a live watcher, or 'stuck' when it never got free. */
const take = async (tries = 25): Promise<'taken' | 'held' | 'stuck'> => {
  if (await made(LOCK)) {
    return 'taken'
  }
  if (await liveHolder()) {
    return 'held'
  }
  if (tries <= 1) {
    return 'stuck'
  }
  await takeOver()
  return take(tries - 1)
}

/**
 * One watcher per state directory; exits 75 when another one runs. Creating a directory is atomic, so
 * of two watchers starting at once only one gets it. A lock left by a watcher that died is taken over.
 */
export const lock = async (): Promise<void> => {
  await $`mkdir -p ${DIR}`.quiet()
  const outcome = await take()
  if (outcome !== 'taken') {
    process.stderr.write(outcome === 'held' ? `another watcher already uses ${DIR}\n` : `the lock ${LOCK} stays taken: remove it if no watcher runs\n`)
    process.exit(75)
  }
  await writeLines('lock.d/pid', [String(process.pid)])
  // Synchronously: an exit handler can't wait for anything.
  process.on('exit', () => { Bun.spawnSync(['rm', '-rf', stateFile('lock.d')]) })
  // Stopped by a signal (a timeout, Ctrl-C): exit normally, so the lock above is released too.
  process.on('SIGTERM', () => { process.exit(143) })
  process.on('SIGINT', () => { process.exit(130) })
}
