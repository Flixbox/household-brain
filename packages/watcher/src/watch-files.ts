/* oxlint-disable import/no-nodejs-modules -- Bun has no directory listing or rename of its own; node:fs/promises is built into Bun */
/** Where the project watchers on this machine keep their files, and how they write and tidy them. */
import { mkdir, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { ignoreFailure, isRecord } from './read'

const stateHome = process.env.XDG_STATE_HOME ?? `${process.env.HOME ?? '.'}/.local/state`
/** Every watcher's files, each repository's in a folder of its own (`owner_name`). */
export const WATCHERS_DIR = `${stateHome}/watch-project`

/** How many writes this process has started: each gets a temporary file of its own. */
const writes = { started: 0 }

/**
 * Written to a temporary file and renamed over the old one, so a write that fails halfway never leaves
 * a file cut short. The temporary file is this write's own: two writes of the same file at once (two
 * watchers, or two looks of one) each rename a whole one (#264). Bun.write creates the folder on first use.
 */
export const writeWhole = async (path: string, text: string): Promise<void> => {
  writes.started += 1
  const draft = `${path}.${process.pid}-${writes.started}.writing`
  await Bun.write(draft, text)
  await rename(draft, path)
}

/**
 * Removes what in `dir` hasn't changed for `maxAge` (in hours or less, #264): every watcher leaves
 * files behind, and nothing else would ever remove them. Tidying only: what can't be removed stays
 * for the next watcher that starts.
 */
export const removeOlder = async (dir: string, maxAge: Temporal.Duration): Promise<void> => {
  const before = Temporal.Now.instant().subtract(maxAge).epochMilliseconds
  const names = await readdir(dir).catch((): string[] => [])
  await Promise.all(names.map(async name => {
    const path = `${dir}/${name}`
    const changed = await stat(path).then(info => info.mtimeMs, () => Number.POSITIVE_INFINITY)
    await (changed < before ? rm(path, { force: true, recursive: true }) : Promise.resolve())
  })).catch(ignoreFailure)
}

/**
 * Creates the empty file `path` unless it is there, for something only one watcher on this machine may
 * do (#303): true for the one that created it, false where it was there already. Any other failure
 * fails, so nothing is done on a claim that couldn't be made. `unclaim` gives it back.
 */
export const claim = async (path: string): Promise<boolean> => {
  await mkdir(dirname(path), { recursive: true })
  return writeFile(path, '', { flag: 'wx' }).then(() => true, (error: unknown) => {
    if (isRecord(error) && error.code === 'EEXIST') {
      return false
    }
    throw error
  })
}

export const unclaim = async (path: string): Promise<void> => rm(path, { force: true })
