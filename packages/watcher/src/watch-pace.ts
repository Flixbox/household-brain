/**
 * Pacing that reads GitHub's rate limit (#400). `gh` prints each answer's headers to stderr under
 * GH_DEBUG=api, for every kind of call, so watch-gh.ts hands that log here. What it says is kept in a
 * file per `gh` and repository owner (the limit belongs to the login or installation behind them), so
 * every watcher on this machine knows it: after a refusal none asks GitHub until the wait is over,
 * and all stretch their pauses while the budget runs short.
 */
import { WATCHERS_DIR, removeOlder, writeWhole } from './watch-files'
import { hasText, ignoreFailure, isRecord } from './read'

interface Budget {
  limit: number
  remaining: number
  resetMs: number
}
export interface Limits {
  blockedUntilMs: number
  budgets: Record<string, Budget>
}
export const NO_LIMITS: Limits = { blockedUntilMs: 0, budgets: {} }

interface GhResponse {
  headers: Map<string, string>
  status: number
}
interface Call {
  failed: boolean
  nowMs: number
}

const HOUR_MS = 3_600_000
const MARGIN_MS = 5000
/** GitHub's advice for a secondary limit that names no time: wait at least a minute. */
const UNNAMED_WAIT_MS = 60_000
/** A body can't fake these: gh logs JSON pretty-printed, so its lines are indented or start with a bracket. */
const STATUS_LINE = /^< HTTP\/\S+ (?<status>\d{3})/u
const HEADER_LINE = /^< (?<name>x-ratelimit-(?:limit|remaining|reset|resource)|retry-after): *(?<value>\S+)/iu
// Quotes inside a string are escaped in the log, so a comment quoting this can't match it.
const GRAPHQL_REFUSAL = /"type":\s*"RATE_LIMITED"/u
const REFUSAL = /rate limit/iu
const SECONDARY_REFUSAL = /secondary rate limit/iu

const responsesIn = (log: string): GhResponse[] => {
  const responses: GhResponse[] = []
  for (const line of log.split('\n')) {
    const status = STATUS_LINE.exec(line)?.groups?.status
    if (hasText(status)) { responses.push({ headers: new Map(), status: Number(status) }) }
    const header = HEADER_LINE.exec(line)?.groups
    if (hasText(header?.name) && hasText(header.value)) { responses.at(-1)?.headers.set(header.name.toLowerCase(), header.value) }
  }
  return responses
}

const numberOf = (response: GhResponse, header: string): number | null => {
  const value = Number(response.headers.get(header) ?? Number.NaN)
  return Number.isFinite(value) ? value : null
}

/** The response's budget. Split counters answer with different resets (#357), so the latest still ahead stays. */
const budgetOf = (response: GhResponse, known: Budget | undefined, nowMs: number): Budget | null => {
  const limit = numberOf(response, 'x-ratelimit-limit')
  const remaining = numberOf(response, 'x-ratelimit-remaining')
  const reset = numberOf(response, 'x-ratelimit-reset')
  if (limit === null || remaining === null || reset === null) { return null }
  const knownReset = known && known.resetMs > nowMs ? known.resetMs : 0
  return { limit, remaining, resetMs: Math.max(reset * 1000, knownReset) }
}

const isRefused = (response: GhResponse, log: string, failed: boolean): boolean => {
  if (numberOf(response, 'x-ratelimit-remaining') === 0 || GRAPHQL_REFUSAL.test(log)) { return true }
  return failed && (response.status === 429 || (response.status === 403 && REFUSAL.test(log)))
}

/** Until when this response says to stop asking; 0 when it doesn't. */
const waitAfter = ({ failed, log, nowMs, resetMs, response }: Call & { log: string, resetMs: number, response: GhResponse }): number => {
  const retryAfter = response.status >= 400 ? numberOf(response, 'retry-after') : null
  if (retryAfter !== null && retryAfter > 0) { return nowMs + (retryAfter * 1000) }
  if (!isRefused(response, log, failed)) { return 0 }
  const secondary = failed && SECONDARY_REFUSAL.test(log)
  return !secondary && resetMs > nowMs ? resetMs : nowMs + UNNAMED_WAIT_MS
}

/** A wait with its margin, and never over an hour: a window is no longer, whatever a header says. */
const waitUntil = (untilMs: number, nowMs: number) => untilMs === 0 ? 0 : Math.min(untilMs, nowMs + HOUR_MS) + MARGIN_MS

/** What is known once a call's GH_DEBUG log has been read. */
export const updatedLimits = (limits: Limits, log: string, call: Call): Limits => {
  const budgets = { ...limits.budgets }
  const waits = [limits.blockedUntilMs]
  for (const response of responsesIn(log)) {
    const resource = response.headers.get('x-ratelimit-resource') ?? 'core'
    const budget = budgetOf(response, budgets[resource], call.nowMs)
    if (budget) { budgets[resource] = budget }
    waits.push(waitUntil(waitAfter({ ...call, log, resetMs: budget?.resetMs ?? 0, response }), call.nowMs))
  }
  return { blockedUntilMs: Math.max(...waits), budgets }
}

const LOW_SHARE = 0.4
const VERY_LOW_SHARE = 0.2

const stretchOf = (budget: Budget, nowMs: number): number => {
  const share = budget.remaining / budget.limit
  const timeShare = Math.min(1, (budget.resetMs - nowMs) / HOUR_MS)
  if (budget.resetMs <= nowMs || share >= LOW_SHARE || share >= timeShare) { return 1 }
  return share < VERY_LOW_SHARE ? 4 : 2
}

/** How many times longer to pause: more when the budget left falls behind the time left in its window. */
export const stretchFor = (limits: Limits, nowMs: number): number =>
  Math.max(1, ...Object.values(limits.budgets).map(budget => stretchOf(budget, nowMs)))

const BUSY_GAP_MS = 10_000
/** A poller's pause, times this, for its first, second and later quiet looks in a row. */
const QUIET_STEPS = [1, 2, 5]

export const pauseMs = ({ baseMs, busy, quietLooks, stretch }: { baseMs: number, busy: boolean, quietLooks: number, stretch: number }): number => {
  const step = QUIET_STEPS[Math.min(Math.max(quietLooks, 1), QUIET_STEPS.length) - 1] ?? 1
  return (busy ? BUSY_GAP_MS : baseMs * step) * stretch
}

const LIMITS_DIR = `${WATCHERS_DIR}/rate-limits`
// A window lasts an hour: what is older says nothing any more.
await removeOlder(LIMITS_DIR, Temporal.Duration.from({ hours: 2 }))

/** Whose limits these are; the first calls, before the repository is known, are kept apart. */
const scope = { owner: '' }
export const setLimitsOwner = (repo: string) => { scope.owner = repo.split('/')[0] ?? '' }

const limitsFile = (cli: string) => `${LIMITS_DIR}/${Bun.hash(JSON.stringify([cli, scope.owner])).toString(36)}`
/** The wait has a file of its own, written only for a refusal: a successful call in another watcher can't undo it. */
const blockFile = (cli: string) => `${limitsFile(cli)}.block`

const isBudget = (value: unknown): value is Budget =>
  isRecord(value) && typeof value.limit === 'number' && typeof value.remaining === 'number' && typeof value.resetMs === 'number'

const parsedLimits = (text: string): Limits => {
  const value: unknown = JSON.parse(text)
  if (!isRecord(value) || typeof value.blockedUntilMs !== 'number' || !isRecord(value.budgets)) { return NO_LIMITS }
  return { blockedUntilMs: value.blockedUntilMs, budgets: Object.fromEntries(Object.entries(value.budgets).filter((entry): entry is [string, Budget] => isBudget(entry[1]))) }
}

/** What is known about this `gh`'s limit; nothing, when no watcher has written it or it can't be read. */
const readLimits = async (cli: string): Promise<Limits> => {
  const [limits, blocked] = await Promise.all([
    Bun.file(limitsFile(cli)).text().then(parsedLimits).catch(() => NO_LIMITS),
    Bun.file(blockFile(cli)).text().then(Number).catch(() => 0),
  ])
  return { ...limits, blockedUntilMs: Number.isFinite(blocked) ? Math.max(limits.blockedUntilMs, blocked) : limits.blockedUntilMs }
}

/** The `gh`s this watcher has asked with: each has a limit of its own. */
const asking = new Set<string>()

/** Takes in a call's log. Pacing is only a saving: a log that can't be kept changes nothing else. */
export const noteLimits = async (cli: string, log: string, failed: boolean): Promise<void> => {
  asking.add(cli)
  if (!log.includes('< HTTP/')) { return }
  const known = await readLimits(cli)
  const updated = updatedLimits(known, log, { failed, nowMs: Temporal.Now.instant().epochMilliseconds })
  if (updated.blockedUntilMs > known.blockedUntilMs) { await writeWhole(blockFile(cli), String(updated.blockedUntilMs)).catch(ignoreFailure) }
  await writeWhole(limitsFile(cli), JSON.stringify(updated)).catch(ignoreFailure)
}

/** When GitHub may be asked again with this `gh`, if that is still to come; otherwise null. */
export const blockedUntil = async (cli: string): Promise<Temporal.Instant | null> => {
  const { blockedUntilMs } = await readLimits(cli)
  return blockedUntilMs > Temporal.Now.instant().epochMilliseconds ? Temporal.Instant.fromEpochMilliseconds(blockedUntilMs) : null
}

/** Quiet looks in a row, per poller; any look with events starts every poller over. */
const quietRuns = new Map<object, number>()

/** How long a poller pauses after a look. */
export const nextPauseMs = async (poller: { pauseSeconds: number }, busy: boolean): Promise<number> => {
  if (busy) { quietRuns.clear() } else { quietRuns.set(poller, (quietRuns.get(poller) ?? 0) + 1) }
  const nowMs = Temporal.Now.instant().epochMilliseconds
  const known = await Promise.all([...asking].map(async cli => readLimits(cli)))
  const stretch = Math.max(1, ...known.map(limits => stretchFor(limits, nowMs)))
  return pauseMs({ baseMs: poller.pauseSeconds * 1000, busy, quietLooks: quietRuns.get(poller) ?? 0, stretch })
}
