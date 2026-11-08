/**
 * Pacing that reads GitHub's rate limit (#400). `gh` prints each answer's headers to stderr under
 * GH_DEBUG=api, for every kind of call, so watch-gh.ts hands that log here. What it says is kept in a
 * file per `gh` and repository owner (the limit belongs to the login or installation behind them), so
 * every watcher on this machine knows it: after a refusal none asks GitHub until the wait is over,
 * and all stretch their pauses while the budget runs short. A used-up primary limit stops only calls
 * on its own resource (`core` and `graphql` are separate buckets); a secondary limit stops them all.
 */
import { WATCHERS_DIR, removeOlder, writeWhole } from './watch-files'
import { hasText, ignoreFailure, isRecord } from './read'

interface Budget {
  limit: number
  remaining: number
  resetMs: number
}
export interface Limits {
  budgets: Record<string, Budget>
  /** Until when calls wait, by resource; ALL_RESOURCES for a limit on every call. */
  waits: Record<string, number>
}
export const NO_LIMITS: Limits = { budgets: {}, waits: {} }
const ALL_RESOURCES = 'all'
const CALL_RESOURCES = ['core', 'graphql'] as const
type CallResource = typeof CALL_RESOURCES[number]

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

/**
 * Whether the hourly budget ran out, as against a secondary limit, which a bare 429 is taken for, and
 * so is a retry-after with budget left.
 */
const isPrimary = (response: GhResponse, log: string, retries: boolean): boolean => {
  if (SECONDARY_REFUSAL.test(log)) { return false }
  return numberOf(response, 'x-ratelimit-remaining') === 0 || (!retries && (GRAPHQL_REFUSAL.test(log) || response.status === 403))
}

interface Wait {
  key: string
  untilMs: number
}

/** Which calls this response stops, and until when; null when it stops none. */
const waitAfter = ({ failed, log, nowMs, resetMs, resource, response }: Call & { log: string, resetMs: number, resource: string, response: GhResponse }): Wait | null => {
  const retryMs = response.status >= 400 ? (numberOf(response, 'retry-after') ?? 0) * 1000 : 0
  if (retryMs <= 0 && !isRefused(response, log, failed)) { return null }
  const primary = isPrimary(response, log, retryMs > 0) && resetMs > nowMs
  if (retryMs > 0) { return { key: primary ? resource : ALL_RESOURCES, untilMs: nowMs + retryMs } }
  return primary ? { key: resource, untilMs: resetMs } : { key: ALL_RESOURCES, untilMs: nowMs + UNNAMED_WAIT_MS }
}

/** A wait with its margin, and never over an hour: a window is no longer, whatever a header says. */
const waitUntil = (untilMs: number, nowMs: number) => Math.min(untilMs, nowMs + HOUR_MS) + MARGIN_MS

/** The entry a wait makes in `waits`, never earlier than one already there; nothing without a wait. */
const laterWait = (waits: Limits['waits'], wait: Wait | null, nowMs: number): Limits['waits'] =>
  wait ? { [wait.key]: Math.max(waits[wait.key] ?? 0, waitUntil(wait.untilMs, nowMs)) } : {}

/** What is known once a call's GH_DEBUG log has been read. */
export const updatedLimits = (limits: Limits, log: string, call: Call): Limits => {
  const budgets = { ...limits.budgets }
  const waits = { ...limits.waits }
  for (const response of responsesIn(log)) {
    const resource = response.headers.get('x-ratelimit-resource') ?? 'core'
    const budget = budgetOf(response, budgets[resource], call.nowMs)
    if (budget) { budgets[resource] = budget }
    Object.assign(waits, laterWait(waits, waitAfter({ ...call, log, resetMs: budget?.resetMs ?? 0, resource, response }), call.nowMs))
  }
  return { budgets, waits }
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

export const pauseMs = ({ baseMs, busy, capMs, quietLooks, stretch }: { baseMs: number, busy: boolean, capMs: number, quietLooks: number, stretch: number }): number => {
  const step = QUIET_STEPS[Math.min(Math.max(quietLooks, 1), QUIET_STEPS.length) - 1] ?? 1
  return (busy ? BUSY_GAP_MS : Math.min(baseMs * step, capMs)) * stretch
}

const LIMITS_DIR = `${WATCHERS_DIR}/rate-limits`
// A window lasts an hour: what is older says nothing any more.
await removeOlder(LIMITS_DIR, Temporal.Duration.from({ hours: 2 }))

/** Whose limits these are; the first calls, before the repository is known, are kept apart. */
const scope = { owner: '' }
export const setLimitsOwner = (repo: string) => { scope.owner = repo.split('/')[0] ?? '' }

const limitsFile = (cli: string) => `${LIMITS_DIR}/${Bun.hash(JSON.stringify([cli, scope.owner])).toString(36)}`
/** Each wait has a file of its own, written only for a refusal: a successful call in another watcher can't undo it. */
const waitFile = (cli: string, key: string) => `${limitsFile(cli)}.wait-${key}`

const isBudget = (value: unknown): value is Budget =>
  isRecord(value) && typeof value.limit === 'number' && typeof value.remaining === 'number' && typeof value.resetMs === 'number'

const parsedLimits = (text: string): Limits => {
  const value: unknown = JSON.parse(text)
  if (!isRecord(value) || !isRecord(value.budgets)) { return NO_LIMITS }
  return { budgets: Object.fromEntries(Object.entries(value.budgets).filter((entry): entry is [string, Budget] => isBudget(entry[1]))), waits: {} }
}

const readWait = async (cli: string, key: string): Promise<[string, number]> => {
  const untilMs = await Bun.file(waitFile(cli, key)).text().then(Number).catch(() => 0)
  return [key, Number.isFinite(untilMs) ? untilMs : 0]
}

/** What is known about this `gh`'s limit; nothing, when no watcher has written it or it can't be read. */
const readLimits = async (cli: string): Promise<Limits> => {
  const [limits, waits] = await Promise.all([
    Bun.file(limitsFile(cli)).text().then(parsedLimits).catch(() => NO_LIMITS),
    Promise.all([ALL_RESOURCES, ...CALL_RESOURCES].map(async key => readWait(cli, key))),
  ])
  return { ...limits, waits: Object.fromEntries(waits) }
}

/** Writes the waits this call moved later. */
const writeWaits = async (cli: string, known: Limits, updated: Limits): Promise<void> => {
  const later = Object.entries(updated.waits).filter(([key, untilMs]) => untilMs > (known.waits[key] ?? 0))
  await Promise.all(later.map(async ([key, untilMs]) => writeWhole(waitFile(cli, key), String(untilMs)).catch(ignoreFailure)))
}

/** The `gh`s this watcher has asked with: each has a limit of its own. */
const asking = new Set<string>()

/** Takes in a call's log. Pacing is only a saving: a log that can't be kept changes nothing else. */
export const noteLimits = async (cli: string, log: string, failed: boolean): Promise<void> => {
  asking.add(cli)
  if (!log.includes('< HTTP/')) { return }
  const known = await readLimits(cli)
  const updated = updatedLimits(known, log, { failed, nowMs: Temporal.Now.instant().epochMilliseconds })
  await writeWaits(cli, known, updated)
  await writeWhole(limitsFile(cli), JSON.stringify(updated)).catch(ignoreFailure)
}

/** Which budget a `gh` call spends: `run` and REST paths use `core`, the other commands GraphQL. */
export const resourceOf = (args: readonly string[]): CallResource => {
  const [command] = args
  if (command === 'api') { return args.includes('graphql') ? 'graphql' : 'core' }
  return command === 'run' ? 'core' : 'graphql'
}

/** When GitHub may be asked again on this resource with this `gh`, if that is still to come; otherwise null. */
export const blockedUntil = async (cli: string, resource: CallResource): Promise<Temporal.Instant | null> => {
  const { waits } = await readLimits(cli)
  const untilMs = Math.max(waits[ALL_RESOURCES] ?? 0, waits[resource] ?? 0)
  return untilMs > Temporal.Now.instant().epochMilliseconds ? Temporal.Instant.fromEpochMilliseconds(untilMs) : null
}

/** Quiet looks in a row, per poller; any look with events starts every poller over. */
const quietRuns = new Map<object, number>()

/** How long a poller pauses after a look. */
export const nextPauseMs = async (poller: { pauseSeconds: number, quietCapSeconds: number }, busy: boolean): Promise<number> => {
  if (busy) { quietRuns.clear() } else { quietRuns.set(poller, (quietRuns.get(poller) ?? 0) + 1) }
  const nowMs = Temporal.Now.instant().epochMilliseconds
  const known = await Promise.all([...asking].map(async cli => readLimits(cli)))
  const stretch = Math.max(1, ...known.map(limits => stretchFor(limits, nowMs)))
  return pauseMs({ baseMs: poller.pauseSeconds * 1000, busy, capMs: poller.quietCapSeconds * 1000, quietLooks: quietRuns.get(poller) ?? 0, stretch })
}
