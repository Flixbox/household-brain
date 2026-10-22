/**
 * What a project watcher remembers between runs, in plain files (the same ones the earlier bash
 * watcher kept, so either can take over from the other):
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
 *
 * Any number of watchers can watch one repository at once, and each reports every event (#264): each
 * remembers in a folder of its own, by its WATCHER_ID.
 */
import { REPO } from './watch-github'
import { WATCHERS_DIR, removeOlder, writeWhole } from './watch-files'
import { hasText, ignoreFailure } from './read'

// WATCHER_ID: which watcher this is (#264); by default the Claude Code session's id, so a watcher
// started again in the same session (a re-armed Monitor) goes on where the last one stopped, and one
// in another session keeps a record of its own. Without either, the repository's own folder, shared
// by every watcher without an id: those would split the events between them. STATE_DIR names the
// folder outright.
const WATCHER_ID = [process.env.WATCHER_ID, process.env.CLAUDE_CODE_SESSION_ID].find(hasText)
const REPO_DIR = `${WATCHERS_DIR}/${REPO.replace('/', '_')}`
const SESSIONS_DIR = `${REPO_DIR}/sessions`
const DIR = [process.env.STATE_DIR, WATCHER_ID && `${SESSIONS_DIR}/${WATCHER_ID.replaceAll(/[^\w.-]/gu, '_')}`].find(hasText) ?? REPO_DIR

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

const write = async (name: string, lines: readonly string[]): Promise<void> =>
  retried(async () => writeWhole(stateFile(name), lines.length > 0 ? `${lines.join('\n')}\n` : ''))

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

/**
 * Gets this watcher going: the record of a session that ended long ago is removed (#264), and a stop
 * signal (a timeout, Ctrl-C) ends it normally, so what a round found is still printed.
 */
export const start = async (): Promise<void> => {
  // A session that came back after this long starts afresh: it hears where each PR stands again.
  await removeOlder(SESSIONS_DIR, Temporal.Duration.from({ hours: 24 * 14 }))
  process.on('SIGTERM', () => { process.exit(143) })
  process.on('SIGINT', () => { process.exit(130) })
}
