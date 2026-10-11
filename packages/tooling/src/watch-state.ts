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
 *   lock           the running watcher's process id: two would race on these files
 */
import { $ } from 'bun'
import { REPO } from './watch-github'

const home = process.env.HOME ?? '.'
const DIR = process.env.STATE_DIR ?? `${process.env.XDG_STATE_HOME ?? `${home}/.local/state`}/watch-project/${REPO.replace('/', '_')}`

const stateFile = (name: string) => `${DIR}/${name}`

export const exists = (name: string): Promise<boolean> => Bun.file(stateFile(name)).exists()

export const readLines = async (name: string): Promise<string[]> =>
  ((await exists(name)) ? (await Bun.file(stateFile(name)).text()).split('\n').filter(Boolean) : [])

/** Bun.write creates the state directory on first use. */
export const writeLines = async (name: string, lines: readonly string[]): Promise<void> => {
  await Bun.write(stateFile(name), lines.length > 0 ? `${lines.join('\n')}\n` : '')
}

export const appendLines = async (name: string, lines: readonly string[]): Promise<void> =>
  writeLines(name, [...await readLines(name), ...lines])

const alive = (pid: number) => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/**
 * One watcher per state directory; exits 75 when another one runs. Creating a directory is atomic, so
 * of two watchers starting at once only one gets it. A lock left by a watcher that died is taken over.
 */
export const lock = async (): Promise<void> => {
  await $`mkdir -p ${DIR}`.quiet()
  if ((await $`mkdir ${stateFile('lock.d')}`.quiet().nothrow()).exitCode !== 0) {
    const [holder] = await readLines('lock.d/pid')
    if (holder && alive(Number(holder))) {
      process.stderr.write(`another watcher already uses ${DIR}\n`)
      process.exit(75)
    }
  }
  await writeLines('lock.d/pid', [String(process.pid)])
  // Synchronously: an exit handler can't wait for anything.
  process.on('exit', () => { Bun.spawnSync(['rm', '-rf', stateFile('lock.d')]) })
  // Stopped by a signal (a timeout, Ctrl-C): exit normally, so the lock above is released too.
  process.on('SIGTERM', () => { process.exit(143) })
  process.on('SIGINT', () => { process.exit(130) })
}
