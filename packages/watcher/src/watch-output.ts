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
import { appendLines, askedBots, claimReportedLine, oneAtATime, readLines, subscriptions, writeLines } from './watch-state'
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
 * A round that ends early (an error, a stop signal: both end in `exit`) still prints what it found.
 * Synchronously: an exit handler can't wait. What waits for the print through `afterDelivery` isn't
 * written on that path, so such an event may come again next run: twice rather than never (#435, #482).
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

/** Writes that wait until what was queued before them has been printed (not following). */
const afterPrint: (() => Promise<void>)[] = []
/** Keys handed to `markSeen` and not written yet, so a second look of the round doesn't report them again. */
const unwritten = new Set<string>()
const unwrittenKey = (file: string, key: string) => `${file} ${key}`

const writeMarks = async (): Promise<void> => {
  await Promise.all(afterPrint.splice(0).map(async work => work()))
}

/** Runs `write` once the events queued so far are printed: now when following, at the round's print otherwise. */
const afterDelivery = async (write: () => Promise<void>): Promise<void> => {
  await (FOLLOW ? write() : Promise.resolve(afterPrint.push(write)))
}

export const isUnwritten = (file: string, key: string): boolean => unwritten.has(unwrittenKey(file, key))

/**
 * Records `keys` in the seen file `file`, then runs `then`, once the events just queued are printed
 * (#435): a crash before that reports them again rather than losing them. Queue the events first.
 */
export const markSeen = async (file: string, keys: readonly string[], then: () => Promise<void> = async () => Promise.resolve()): Promise<void> => {
  const held = keys.map(key => unwrittenKey(file, key))
  for (const key of held) { unwritten.add(key) }
  const write = async () => {
    await appendLines(file, keys)
    await then()
    for (const key of held) { unwritten.delete(key) }
  }
  await afterDelivery(write)
}

/** Whole-file states waiting for their print, so a second look of the round compares with them. */
const unwrittenFiles = new Map<string, readonly string[]>()

/** Replaces the state file `file` with `lines` once the events just queued are printed (#482). Queue the events first. */
export const writeDelivered = async (file: string, lines: readonly string[]): Promise<void> => {
  unwrittenFiles.set(file, lines)
  await afterDelivery(async () => {
    await writeLines(file, lines)
    if (unwrittenFiles.get(file) === lines) { unwrittenFiles.delete(file) }
  })
}

/** A file written through `writeDelivered`, with what still waits for its print. */
export const deliveredLines = async (file: string): Promise<readonly string[]> => unwrittenFiles.get(file) ?? readLines(file)

const REPORTED = 'reported'
const heldReported = () => [...unwritten].filter(key => key.startsWith(`${REPORTED} `)).map(key => key.slice(REPORTED.length + 1))

/** What counts as reported: the file, and what was claimed and waits for its print (#482). */
export const reportedLines = async (): Promise<string[]> => {
  // Held first: a key written while the file is read is then in one of them at least.
  const held = heldReported()
  const lines = await readLines(REPORTED)
  return [...lines, ...held.filter(key => !lines.includes(key))]
}

/**
 * Claims `key` for this watcher unless it was reported before; true when it is news. Checked and held
 * in one step, so two pollers finding the same event report it once. The caller queues the event and
 * then records it with `markReported`, so a crash before the print reports it again (#482).
 * A CI result recorded before its key held the run id isn't news (#486).
 */
export const claimReported = async (key: string): Promise<boolean> => claimReportedLine(key, () => {
  if (isUnwritten(REPORTED, key)) { return false }
  unwritten.add(unwrittenKey(REPORTED, key))
  return true
})

export const markReported = async (key: string): Promise<void> => markSeen(REPORTED, [key])

/**
 * Queues the event claimed under `claimed`. A print that fails gives the claim back, so the next look
 * reports the event instead of it waiting for a restart (#498). Only then: nothing was printed yet for
 * another poller to have missed, and the outbox takes a stable key once.
 */
export const queueClaimed = (claimed: string, lines: readonly string[], options: QueueOptions = {}): void => {
  try {
    queue(lines, options)
  } catch (error) {
    unwritten.delete(unwrittenKey(REPORTED, claimed))
    throw error
  }
}

/** Keeps the event for this round's `flush`, unless there is none or it was reported before. */
export const report = async (event: Event | null, pr: number | null = null): Promise<void> => {
  const audience = pr === null ? {} : { pr }
  if (!event || !subscriptions.accepts({ ...audience, quiet: event.quiet === true }) || !await claimReported(event.key)) {
    return
  }
  const [first = '', ...rest] = event.lines
  // Every CI result comes with where each open PR stands, so no approval goes unnoticed.
  const prs = !subscriptions.scoped && listsOpenPrs(event.key) ? await openPrsThisLook().then(openPrLines, () => ['Open PRs: (listing failed)']) : []
  queueClaimed(event.key, [pr === null ? first : `PR #${pr}: ${first}`, ...rest, ...prs], { ...audience, key: `event:${pr}:${event.key}`, quiet: event.quiet === true })
  await markReported(event.key)
}

/** A branch only behind main is said once per main head (#508); a queued or conflicting PR's reminder keeps coming. */
const saidOncePerHead = (pr: OpenPr) => !pr.parked && !pr.queued && pr.mergeState === 'BEHIND'

/**
 * Claims the behind-main reminders that are news at main's head, the one `checkMainHead` last saw:
 * `keys` to record once they are printed, `said` the PRs to leave out. While that head is unknown (its
 * read failed) they are all left out, and the next look says them.
 */
const claimBehind = async (prs: readonly OpenPr[]): Promise<{ keys: string[], said: Set<number> }> => {
  const [head = ''] = await readLines('main')
  const claims = await Promise.all(prs.filter(pr => saidOncePerHead(pr)).map(async pr => {
    const key = `pr-${pr.number} behind ${head}`
    // A claim that can't be read holds nothing: that PR is left out, and the next look asks again.
    return { key, news: head !== '' && await claimReported(key).catch(() => false), pr: pr.number }
  }))
  return { keys: claims.filter(claim => claim.news).map(claim => claim.key), said: new Set(claims.filter(claim => !claim.news).map(claim => claim.pr)) }
}

/** The reminders for the open PRs, holding auto-merge for those that wait on a review bot asked for or reviewing (#299, #324); `keys` are claimed. */
const reminders = async (prs: OpenPr[]): Promise<{ keys: string[], lines: string[] }> => {
  const waits = await Promise.all(prs.map(async pr => awaitsBotReview({ asked: await askedBots(pr.number), state: pr.bot })))
  const { keys, said } = await claimBehind(prs)
  return { keys, lines: reminderLines(prs, REPO, { awaitingBot: new Set(prs.filter((_pr, index) => waits[index] === true).map(pr => pr.number)), branchSaid: said }) }
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

/** Prints the reminders with the usage when it is due, then records the claimed `keys`. */
const sayClaimed = async (keys: readonly string[], lines: readonly string[]): Promise<void> => {
  try {
    const closing = [...lines, ...await dueUsage()]
    if (closing.length > 0) {
      say(FOLLOW ? [...closing, '---'] : closing)
    }
  } catch (error) {
    // Nothing came out: the next look says them (#498).
    for (const key of keys) { unwritten.delete(unwrittenKey(REPORTED, key)) }
    throw error
  }
  // Written here: the round's marks were written before these lines, and a one-shot watcher exits next.
  await markSeen(REPORTED, keys)
  await writeMarks()
}

/** The reminders, and the active agent's usage when it is due (#233, #318); nothing when neither has a line. */
const sayClosing = async (): Promise<void> => {
  if (subscriptions.scoped) { return }
  const { keys, lines } = await openPrsThisLook().then(reminders, () => ({ keys: [], lines: [] }))
  await sayClaimed(keys, lines)
}

/** Prints what the round kept, then writes what waited for that; whether the round printed anything. */
const printRound = async (): Promise<boolean> => {
  const any = found.length > 0 || printed.any
  printFound()
  printed.any = false
  await writeMarks()
  return any
}

/**
 * Ends a round that found events: prints the ones kept (not following), answers first, and after them
 * a reminder for each open PR waiting on the agent (#224, #226); then exits, or when following, ends
 * with `---` and returns whether anything was printed, so the next round can start at once.
 */
export const flush = async (): Promise<boolean> => {
  // The events first: a slow listing must not hold them back.
  if (!await printRound()) {
    return false
  }
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
