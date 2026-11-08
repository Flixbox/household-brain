/**
 * How the project watcher (watch-project.ts) prints events, each with the time it was found in front
 * (#240). By default every event a round finds comes out together when the round ends, the ones
 * someone waits for an answer to first (#222), and then it exits (for a background command whose exit
 * is the notification). With `--follow`, each event comes out the moment it is found, ending with a
 * `---` line, so one slow call never holds back an event found before it (#240), and it goes on (#196).
 */
import { type Audience, SUBSCRIPTIONS_COMPLETE } from './watch-subscription-model'
import { deliver, deliveryPending } from './watch-delivery'
import { agentUsageText, readAgentUsage } from './agent-usage'
import { type Event, type OpenPr, answerFirst, clockTime, listsOpenPrs, openPrLines, reminderLines, stamped } from './watch-events'
import { lookupNews, lookups } from './watch-gh'
import { REPO, endOpenPrsLook, openPrsThisLook } from './watch-open-prs'
import { addLine, askedBots, oneAtATime, readLines, subscriptions, writeLines } from './watch-state'
import { awaitsBotReview } from './watch-bot-review-events'
import { codeVersion, outdatedLine, startedOn } from './watch-version'
import { postedFrom, shownUsage, usageDue } from './watch-usage'

export const FOLLOW = process.argv.includes('--follow')

/** When the last event (or, following, the last heartbeat) was printed. */
export const quiet = { since: Temporal.Now.instant() }
const say = (lines: readonly string[], key: string = crypto.randomUUID()) => {
  deliver(key, lines)
  process.stdout.write(`${lines.join('\n')}\n`)
}

/** The events found so far in this round, printed together by `flush` (not following). */
const found: (readonly string[])[] = []
const eventKeys = new WeakMap<readonly string[], string>()
/** Whether this round printed an event already (following), so `flush` closes it. */
const printed = { any: false }

/**
 * An event is recorded as reported when it is found, before the round prints it. So a round that
 * ends early (an error, a stop signal: both end in `exit`) still prints what it found, rather than
 * leaving events recorded but never shown. Synchronously: an exit handler can't wait.
 */
const printFound = () => {
  for (const lines of answerFirst(found)) {
    say(FOLLOW ? [...lines, '---'] : lines, eventKeys.get(lines))
  }
  found.length = 0
}
process.on('exit', printFound)

/**
 * Prints an event at once when following, or keeps it for this round's `flush`. `written` is when
 * GitHub says it happened, for a comment or an issue.
 */
interface QueueOptions extends Audience { key?: string, written?: unknown }
export const queue = (lines: readonly string[], options: QueueOptions = {}): void => {
  if (!subscriptions.accepts(options)) { return }
  const key = options.key ?? crypto.randomUUID()
  const event = stamped(lines, clockTime(Temporal.Now.instant()) ?? '?', clockTime(options.written))
  if (FOLLOW) {
    say([...event, '---'], key)
    printed.any = true
    return
  }
  eventKeys.set(event, key)
  found.push(event)
}

/** Keeps the event for this round's `flush`, unless there is none or it was reported before. */
export const report = async (event: Event | null, pr: number | null = null): Promise<void> => {
  // Checked and recorded in one step: two pollers finding the same event report it once.
  const audience = pr === null ? {} : { pr }
  if (!event || !subscriptions.accepts({ ...audience, quiet: event.quiet === true }) || !await addLine('reported', event.key)) {
    return
  }
  const [first = '', ...rest] = event.lines
  // Every CI result comes with where each open PR stands, so no approval goes unnoticed.
  const prs = !subscriptions.scoped && listsOpenPrs(event.key) ? await openPrsThisLook().then(openPrLines, () => ['Open PRs: (listing failed)']) : []
  queue([pr === null ? first : `PR #${pr}: ${first}`, ...rest, ...prs], { ...audience, key: `event:${pr}:${event.key}`, quiet: event.quiet === true })
}

/** The reminders for the open PRs, holding auto-merge for those that wait on a review bot asked for or reviewing (#299, #324). */
const reminders = async (prs: OpenPr[]): Promise<string[]> => {
  const waits = await Promise.all(prs.map(async pr => awaitsBotReview({ asked: await askedBots(pr.number), state: pr.bot })))
  return reminderLines(prs, REPO, new Set(prs.filter((_pr, index) => waits[index] === true).map(pr => pr.number)))
}

/**
 * The active agent's usage line (#233), only when it is due (#318): on a 2.5% step, or 10 minutes
 * after this watcher's last one. Decided and recorded in one step, so two pollers post it once.
 */
const dueUsage = async (): Promise<string[]> => oneAtATime('usage-due', async () => {
  const usage = await readAgentUsage()
  const at = Temporal.Now.instant().epochMilliseconds
  const shown = shownUsage(usage.answer, at)
  const [last = ''] = await readLines(`usage-${usage.provider}`)
  if (!usageDue(postedFrom(last), shown)) {
    return []
  }
  await writeLines(`usage-${usage.provider}`, [JSON.stringify(shown)])
  return [agentUsageText(usage, at)]
})

/** The reminders, and the active agent's usage when it is due (#233, #318); nothing when neither has a line. */
const sayClosing = async (): Promise<void> => {
  if (subscriptions.scoped) { return }
  const closing = [...await openPrsThisLook().then(reminders, () => []), ...await dueUsage()]
  if (closing.length > 0) {
    say(FOLLOW ? [...closing, '---'] : closing)
  }
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
  await sayClosing()
  endOpenPrsLook()
  quiet.since = Temporal.Now.instant()
  if (!FOLLOW) {
    process.exit(0)
  }
  return true
}

/**
 * Following, the usage line comes on its own when it is due and no event brought it (#318): a step
 * or the heartbeat in a quiet repository. A one-shot watcher exits only on events, so not there.
 */
export const reportUsage = async (): Promise<void> => {
  const lines = FOLLOW && !subscriptions.scoped ? await dueUsage() : []
  if (lines.length > 0) {
    say([...lines, '---'])
  }
}

/**
 * Says so when no `gh` call has succeeded for a while (#253): every check treats a failed call as
 * "try again next look", so a watcher whose calls all fail would otherwise look like a quiet repository.
 */
export const reportLookups = async (): Promise<void> => {
  const { failing, line } = lookupNews(lookups, Temporal.Now.instant(), clockTime(lookups.lastSuccess) ?? '?')
  if (line !== null) {
    queue([line], { system: true })
    await flush()
  }
  // Only once the line is out: if printing failed, the next look says it again, LOOKUPS_RECOVERED too.
  lookups.failing = failing
}

/** Stops the watcher once its checkout holds other code than it started on (#265), so it is started again on the new code. */
export const checkCode = async (): Promise<void> => {
  const line = outdatedLine(startedOn(), await codeVersion())
  if (line !== null) {
    queue([line], { system: true })
    await flush()
    process.exit(0)
  }
}

/** A completed selection stops only after the durable host outbox is acknowledged. */
export const finishSubscriptions = (): void => {
  if (subscriptions.canStop(deliveryPending())) { process.exit(SUBSCRIPTIONS_COMPLETE) }
}
