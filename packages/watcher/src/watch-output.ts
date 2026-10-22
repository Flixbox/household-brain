/**
 * How the project watcher (watch-project.ts) prints events, each with the time it was found in front
 * (#240). By default every event a round finds comes out together when the round ends, the ones
 * someone waits for an answer to first (#222), and then it exits (for a background command whose exit
 * is the notification). With `--follow`, each event comes out the moment it is found, ending with a
 * `---` line, so one slow call never holds back an event found before it (#240), and it goes on (#196).
 */
import { usageLine } from './claude-usage'
import { type Event, answerFirst, clockTime, listsOpenPrs, openPrLines, reminderLines, stamped } from './watch-events'
import { lookupNews, lookups } from './watch-gh'
import { openPrs } from './watch-github'
import { addLine } from './watch-state'

export const FOLLOW = process.argv.includes('--follow')

/** When the last event (or, following, the last heartbeat) was printed. */
export const quiet = { since: Temporal.Now.instant() }
const say = (lines: readonly string[]) => process.stdout.write(`${lines.join('\n')}\n`)

/** The events found so far in this round, printed together by `flush` (not following). */
const found: (readonly string[])[] = []
/** Whether this round printed an event already (following), so `flush` closes it. */
const printed = { any: false }

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

/**
 * Prints an event at once when following, or keeps it for this round's `flush`. `written` is when
 * GitHub says it happened, for a comment or an issue.
 */
export const queue = (lines: readonly string[], written: unknown = null): void => {
  const event = stamped(lines, clockTime(Temporal.Now.instant()) ?? '?', clockTime(written))
  if (FOLLOW) {
    say([...event, '---'])
    printed.any = true
    return
  }
  found.push(event)
}

/** Keeps the event for this round's `flush`, unless there is none or it was reported before. */
export const report = async (event: Event | null, pr: number | null = null): Promise<void> => {
  // Checked and recorded in one step: two pollers finding the same event report it once.
  if (!event || !await addLine('reported', event.key)) {
    return
  }
  const [first = '', ...rest] = event.lines
  // Every CI result comes with where each open PR stands, so no approval goes unnoticed.
  const prs = listsOpenPrs(event.key) ? await openPrs().then(openPrLines, () => ['Open PRs: (listing failed)']) : []
  queue([pr === null ? first : `PR #${pr}: ${first}`, ...rest, ...prs])
}

/**
 * Ends a round that found events: prints the ones kept (not following), answers first, and after them
 * a reminder for each open PR waiting on the agent (#224, #226); then exits, or when following, ends
 * with `---` and returns whether anything was printed, so the next round can start at once.
 */
export const flush = async (): Promise<boolean> => {
  if (found.length === 0 && !printed.any) {
    return false
  }
  // The events first: a slow listing must not hold them back.
  printFound()
  printed.any = false
  // Then the reminders, and the owner's Claude usage (#233) to close every notification.
  const closing = [...await openPrs().then(reminderLines, () => []), await usageLine()]
  say(FOLLOW ? [...closing, '---'] : closing)
  quiet.since = Temporal.Now.instant()
  if (!FOLLOW) {
    process.exit(0)
  }
  return true
}

/**
 * Says so when no `gh` call has succeeded for a while (#253): every check treats a failed call as
 * "try again next look", so a watcher whose calls all fail would otherwise look like a quiet repository.
 */
export const reportLookups = async (): Promise<void> => {
  const { failing, line } = lookupNews(lookups, Temporal.Now.instant(), clockTime(lookups.lastSuccess) ?? '?')
  if (line !== null) {
    queue([line])
    await flush()
  }
  // Only once the line is out: if printing failed, the next look says it again, LOOKUPS_RECOVERED too.
  lookups.failing = failing
}
