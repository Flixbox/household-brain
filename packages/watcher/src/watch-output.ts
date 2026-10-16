/**
 * How the project watcher (watch-project.ts) prints events: every event a round finds, together, the
 * ones someone waits for an answer to first (#222). Then it exits (the default, for a background
 * command whose exit is the notification) or, with `--follow`, ends each event with a `---` line and
 * goes on (#196).
 */
import { type Event, answerFirst, listsOpenPrs, openPrLines, reminderLines } from './watch-events'
import { openPrs } from './watch-github'
import { appendLines, readLines } from './watch-state'

const FOLLOW = process.argv.includes('--follow')

/** When the last event (or, following, the last heartbeat) was printed. */
export const quiet = { since: Temporal.Now.instant() }
const say = (lines: readonly string[]) => process.stdout.write(`${lines.join('\n')}\n`)

/** The events found so far in this round, printed together by `flush`. */
const found: (readonly string[])[] = []

/**
 * An event is recorded as reported when it is found, before the round prints it. So a round that
 * ends early (an error, a stop signal: both end in `exit`) still prints what it found, rather than
 * leaving events recorded but never shown. Synchronously: an exit handler can't wait.
 */
const printFound = () => {
  for (const lines of answerFirst(found)) {
    say(FOLLOW ? [...lines, '---'] : lines)
  }
  found.length = 0
}
process.on('exit', printFound)

/** Keeps an event's lines for this round's `flush`. */
export const queue = (lines: readonly string[]): void => {
  found.push(lines)
}

/** Keeps the event for this round's `flush`, unless there is none or it was reported before. */
export const report = async (event: Event | null, pr: number | null = null): Promise<void> => {
  if (!event || (await readLines('reported')).includes(event.key)) {
    return
  }
  await appendLines('reported', [event.key])
  const [first = '', ...rest] = event.lines
  // Every CI result comes with where each open PR stands, so no approval goes unnoticed.
  const prs = listsOpenPrs(event.key) ? await openPrs().then(openPrLines, () => ['Open PRs: (listing failed)']) : []
  queue([pr === null ? first : `PR #${pr}: ${first}`, ...rest, ...prs])
}

/**
 * Prints the round's events, answers first, and after them a reminder for each open PR waiting on
 * the agent (#224, #226); then exits, or when following, ends each with `---` and returns whether
 * anything was printed, so the next round can start at once.
 */
export const flush = async (): Promise<boolean> => {
  if (found.length === 0) {
    return false
  }
  // The events first: a slow listing must not hold them back.
  printFound()
  const reminders = await openPrs().then(reminderLines, () => [])
  if (reminders.length > 0) {
    say(FOLLOW ? [...reminders, '---'] : reminders)
  }
  quiet.since = Temporal.Now.instant()
  if (!FOLLOW) {
    process.exit(0)
  }
  return true
}
