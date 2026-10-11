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
import { REPO } from './watch-github'

const home = process.env.HOME ?? '.'
const DIR = process.env.STATE_DIR ?? `${process.env.XDG_STATE_HOME ?? `${home}/.local/state`}/watch-project/${REPO.replace('/', '_')}`

const stateFile = (name: string) => `${DIR}/${name}`

export const exists = (name: string): Promise<boolean> => Bun.file(stateFile(name)).exists()

export const readLines = async (name: string): Promise<string[]> =>
  ((await exists(name)) ? (await Bun.file(stateFile(name)).text()).split('\n').filter(Boolean) : [])

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

/** One watcher per state directory; exits 75 when another one runs. */
export const lock = async (): Promise<void> => {
  const [holder] = await readLines('lock')
  if (holder && Number(holder) !== process.pid && alive(Number(holder))) {
    process.stderr.write(`another watcher already uses ${DIR}\n`)
    process.exit(75)
  }
  await writeLines('lock', [String(process.pid)])
}
