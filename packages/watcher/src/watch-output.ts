/**
 * How the project watcher (watch-project.ts) prints an event: once, and then it either exits (the
 * default, for a background command whose exit is the notification) or, with `--follow`, ends the
 * event with a `---` line and goes on (#196).
 */
import { type Event, listsOpenPrs, openPrLines } from './watch-events'
import { openPrs } from './watch-github'
import { appendLines, readLines } from './watch-state'

const FOLLOW = process.argv.includes('--follow')

/** When the last event (or, following, the last heartbeat) was printed. */
export const quiet = { since: Temporal.Now.instant() }
/** Thrown, when following, to end the round after an event; the next round starts at once. */
export const EVENT_PRINTED = new Error('event printed')
const say = (lines: readonly string[]) => process.stdout.write(`${lines.join('\n')}\n`)

/** After an event: exit, or when following, mark its end and start the next round. */
const done = (): never => {
  if (!FOLLOW) {
    return process.exit(0)
  }
  say(['---'])
  quiet.since = Temporal.Now.instant()
  throw EVENT_PRINTED
}

/** Prints the event, then `done`, unless there is none or it was reported before. */
export const report = async (event: Event | null, pr: number | null = null): Promise<void> => {
  if (!event || (await readLines('reported')).includes(event.key)) {
    return
  }
  await appendLines('reported', [event.key])
  const [first = '', ...rest] = event.lines
  say([pr === null ? first : `PR #${pr}: ${first}`, ...rest])
  // Every CI result comes with where each open PR stands, so no approval goes unnoticed.
  if (listsOpenPrs(event.key)) {
    say(await openPrs().then(openPrLines, () => ['Open PRs: (listing failed)']))
  }
  done()
}

/** Prints lines that aren't keyed events (activity, issues), then `done`. */
export const sayAndExit = (lines: readonly string[]): never => {
  say(lines)
  return done()
}
