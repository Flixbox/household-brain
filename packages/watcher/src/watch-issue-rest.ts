/**
 * Issues and issue comments read through REST with `since=` (#412), so that a round where nothing
 * changed is a 304, which costs no rate limit. What the answers mean is decided here (pure, so it is
 * tested); watch-comments.ts and watch-open-issues.ts ask and remember.
 */
import { type Json, count, oneLine, record, records } from './watch-text'
import { type IssueEvent, commentEvent } from './watch-issue-events'
import type { OpenIssue } from './watch-link-cycles'
import { hasText, isRecord, textOf } from './read'

export type Rest = (path: string) => Promise<unknown>

/**
 * How far a list has been read. `cursor` is what the next read asks from; `capped` is where a stuck
 * burst has got to, which becomes the cursor one round later (#469).
 */
export interface Position {
  capped: string | null
  cursor: string | null
}

/** The open issues known, and how far REST's updates have been read into them. */
export interface IssueSnapshot extends Position {
  /** When the whole list was last read, in epoch milliseconds. */
  fullAt: number
  issues: OpenIssue[]
}

const PER_PAGE = 100

/**
 * How far before the cursor each list is asked for. GitHub's `since` has whole seconds, and a list
 * may show an update a moment late; what comes twice is remembered by its key. A cursor that stays
 * put keeps the URL, and so its ETag.
 */
const OVERLAP = Temporal.Duration.from({ minutes: 2 })

/** How far a burst moves the position in a round: less than the overlap, so a read always asks below the old cursor (#469). */
const CAPPED_STEP = Temporal.Duration.from({ minutes: 1 })

/**
 * How often the whole open list is read again. Two things never show as an update: an issue deleted
 * or transferred (#263) leaves no entry in `since`, and adding a blocker doesn't move `updated_at`,
 * so LINK_CYCLE's blockers (#335) can only come from a full read.
 */
const RECONCILE_MS = 15 * 60_000

export const issuesBase = (repo: string): string => `repos/${repo}/issues?state=all&`
export const commentsBase = (repo: string): string => `repos/${repo}/issues/comments?`

export const askedSince = (cursor: string): string =>
  Temporal.Instant.from(cursor).subtract(OVERLAP).round({ roundingMode: 'floor', smallestUnit: 'second' }).toString()

/** Whether a stored value can be a cursor: anything else would fail every later read. */
export const isCursor = (value: unknown): value is string => {
  try {
    return typeof value === 'string' && hasText(Temporal.Instant.from(value).toString())
  } catch {
    return false
  }
}

const listPath = (base: string, cursor: string | null): string => cursor === null
  ? `${base}direction=desc&per_page=${PER_PAGE}&sort=updated`
  : `${base}direction=asc&per_page=${PER_PAGE}&since=${askedSince(cursor)}&sort=updated`

/** One page. An answer that is no list is a failed read, not an empty one (#261). */
const pageOf = async (rest: Rest, path: string, page: number): Promise<Json[]> => {
  const answer = await rest(`${path}&page=${page}`)
  if (!Array.isArray(answer)) {
    throw new TypeError('GitHub answered no list')
  }
  return records(answer)
}

const pagesFrom = async (rest: Rest, path: string, page: number): Promise<Json[][]> => {
  const items = await pageOf(rest, path, page)
  return items.length < PER_PAGE ? [items] : [items, ...await pagesFrom(rest, path, page + 1)]
}

/**
 * The list `base` page by page, oldest update first from before `cursor`. Without a cursor, the
 * first look: one page of the newest, which is all to be taken for old news.
 */
export const readSince = async (rest: Rest, base: string, cursor: string | null): Promise<Json[][]> =>
  cursor === null ? [await pageOf(rest, listPath(base, null), 1)] : pagesFrom(rest, listPath(base, cursor), 1)

/** The newest update on a page; null on an empty one. */
const newestOn = (page: readonly Json[]): string | null =>
  page.map(item => textOf(item.updated_at)).reduce<string | null>((newest, updated) => (newest === null || updated > newest ? updated : newest), null)

/** Whether `newest` is past `cursor`. */
const moves = (newest: string | null, cursor: string | null): newest is string => newest !== null && (cursor === null || newest > cursor)

/** `newest`, but at most one step past `from`. */
const withinStep = (newest: string, from: string): string => {
  const limit = Temporal.Instant.from(from).add(CAPPED_STEP).toString()
  return newest < limit ? newest : limit
}

/**
 * The position after a read: the newest update on the first page, never earlier than it was. Not
 * the last page, as a list that shifted while it was paged can skip an item at a page's edge, and a
 * cursor past that item would lose it: the rest of the list is simply read again next round.
 *
 * When a burst fills the overlap and the first page moves nothing, a later page moves `capped`, by
 * one step at most, and the cursor follows it a round later. So every read during a burst still
 * asks below the old cursor (#469), and a burst can't hold the cursor for good.
 */
export const nextPosition = ({ capped, cursor }: Position, pages: readonly Json[][]): Position => {
  const [first, ...later] = pages.map(page => newestOn(page))
  if (moves(first ?? null, cursor) || cursor === null) {
    return { capped: null, cursor: first ?? cursor }
  }
  const from = capped ?? cursor
  const newer = later.find(newest => moves(newest, from)) ?? null
  return { capped: newer === null ? null : withinStep(newer, from), cursor: capped ?? cursor }
}

/** Whether something written at `created` is news to a read from `cursor`: an old one that only now came up isn't. */
const isNew = (created: unknown, cursor: string | null): boolean => cursor === null || textOf(created) >= askedSince(cursor)

/** The REST issues list also returns pull requests. */
const isIssue = (item: Json): boolean => !Object.hasOwn(item, 'pull_request')

/** New issues among `items`, not the agent's own. */
export const newIssueEvents = (items: readonly Json[], self: string, cursor: string | null): IssueEvent[] =>
  items.filter(item => isIssue(item) && isNew(item.created_at, cursor) && textOf(record(item.user).login) !== self)
    .map(item => ({ at: item.created_at, issue: count(item.number), key: `issue #${count(item.number)}`, lines: [`NEW_ISSUE #${count(item.number)} ${oneLine(item.title, 200)}`] }))

/** The issue a comment is on; null for a comment on a pull request, whose page says `/pull/`. */
const issueOfComment = (comment: Json): number | null => {
  const found = /\/issues\/(?<issue>\d+)#/u.exec(textOf(comment.html_url))
  return found ? Number(found.groups?.issue) : null
}

/** The owner's new comments on issues among `items`. */
export const ownerCommentEvents = (items: readonly Json[], owner: string, cursor: string | null): IssueEvent[] =>
  items.filter(item => textOf(record(item.user).login) === owner && isNew(item.created_at, cursor)).flatMap(item => {
    const issue = issueOfComment(item)
    return issue === null ? [] : [commentEvent({ ...item, createdAt: item.created_at, databaseId: item.id }, issue, owner)]
  })

/** The open issues after the updates in `items`: an issue's known blockers stay, as an update doesn't carry them. */
export const mergeOpen = (known: readonly OpenIssue[], items: readonly Json[]): OpenIssue[] => {
  const issues = new Map(known.map(issue => [issue.number, issue]))
  for (const item of items.filter(entry => isIssue(entry))) {
    const number = count(item.number)
    if (item.state === 'open') {
      issues.set(number, issues.get(number) ?? { blockedBy: [], number })
    } else {
      issues.delete(number)
    }
  }
  return [...issues.values()]
}

const isOpenIssue = (value: unknown): value is OpenIssue =>
  isRecord(value) && typeof value.number === 'number' && Array.isArray(value.blockedBy)

/** A stored snapshot; null for none or a damaged one, which then means a full read. */
export const parseSnapshot = (line: string | null): IssueSnapshot | null => {
  try {
    const value: unknown = JSON.parse(line ?? '')
    return isRecord(value) && (value.cursor === null || isCursor(value.cursor)) && typeof value.fullAt === 'number' && Array.isArray(value.issues) && value.issues.every(isOpenIssue)
      ? { capped: isCursor(value.capped) ? value.capped : null, cursor: value.cursor, fullAt: value.fullAt, issues: value.issues.filter(isOpenIssue) }
      : null
  } catch {
    return null
  }
}

export const reconcileDue = (snapshot: IssueSnapshot, now: number): boolean => now - snapshot.fullAt >= RECONCILE_MS
