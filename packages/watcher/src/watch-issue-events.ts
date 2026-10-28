/** What the watcher reports about issues opening and closing, decided from what GitHub answered (pure, so it is tested). */
import { type Json, actor, at, count, oneLine, record, records } from './watch-text'
import { commentText } from './watch-comment-lines'
import { textOf } from './read'

/** One page of open issues: their numbers, and the cursor of the next page (null on the last). */
export interface IssuePage {
  numbers: number[]
  next: string | null
}

/**
 * A page of GraphQL's `issues` connection. An answer without `pageInfo` is a failed one, not an empty
 * last page: a list cut short would report every issue past it as closed (#261).
 */
export const issuePage = (connection: unknown): IssuePage => {
  const { nodes, pageInfo } = record(connection)
  const info = record(pageInfo)
  if (!Array.isArray(nodes) || typeof info.hasNextPage !== 'boolean') {
    throw new TypeError('GitHub answered no page of open issues')
  }
  const next = textOf(info.endCursor)
  if (info.hasNextPage && next === '') {
    throw new Error('GitHub gave no cursor for the next page of open issues')
  }
  return { next: info.hasNextPage ? next : null, numbers: records(nodes).map(node => count(node.number)) }
}

/**
 * Every open issue, page by page through GraphQL's cursors (#261): GitHub's REST list stopped after
 * its first hundred open issues. Any page failing fails the whole list.
 */
export const allIssueNumbers = async (page: (cursor: string | null) => Promise<IssuePage>, cursor: string | null = null): Promise<number[]> => {
  const { next, numbers } = await page(cursor)
  return next === null ? numbers : [...numbers, ...await allIssueNumbers(page, next)]
}

/**
 * The line for an issue that left or joined the open list, from the issue as GitHub's REST API gives
 * it; null when it isn't news. An issue missing from the open list that GitHub still calls open
 * wasn't closed (#261): the list missed it.
 */
export const issueEventLine = (issue: number, value: Json, change: 'closed' | 'reopened'): string | null => {
  if (change === 'closed') {
    return value.state === 'closed'
      ? `ISSUE_CLOSED #${issue} ${oneLine(value.title, 200)} (${textOf(value.state_reason) || 'closed'}, by ${textOf(record(value.closed_by).login) || '?'})`
      : null
  }
  // A brand-new issue is NEW_ISSUE's; only one that was closed before is reopened.
  return value.closed_at !== null || value.state_reason === 'reopened' ? `ISSUE_REOPENED #${issue} ${oneLine(value.title, 200)}` : null
}

/**
 * Whether a lookup GitHub refused with `status` means the issue is gone (#263): deleted (410), or not
 * there (404: deleted, or moved to a repository this login can't see). Any other failure passes.
 */
export const isGone = (status: number | null): boolean => status === 404 || status === 410

/**
 * Whether GitHub answered the issue from another repository (#263): it was moved there, and GitHub
 * followed the move.
 */
export const isMoved = (value: Json, repo: string): boolean =>
  !textOf(value.repository_url).toLowerCase().endsWith(`/repos/${repo.toLowerCase()}`)

/**
 * The line for an issue that is gone (#263): one that left the open list is closed as far as the work
 * on it goes; one that joined it and is already gone again isn't news.
 */
export const goneIssueLine = (issue: number, change: 'closed' | 'reopened'): string | null =>
  change === 'closed' ? `ISSUE_CLOSED #${issue} (deleted or transferred)` : null

/** A new issue or an owner's issue comment: when it was written, the key it is remembered by, and its lines. */
export interface IssueEvent {
  at: unknown
  key: string
  lines: string[]
}

const AUTHOR = 'author{login kind:__typename}'
const NEWEST = 'orderBy:{field:CREATED_AT,direction:DESC}'
const UPDATED = 'orderBy:{field:UPDATED_AT,direction:DESC}'
/**
 * New issues and issue comments, as GraphQL names them (#314), in one query instead of two
 * repository-wide REST lists, sparing the REST quota agents share (#306): the fifty newest issues and
 * the newest PR's number, and the last twenty comments on each of the fifty issues and PRs updated
 * last (a new comment updates its issue), only their times for a PR's.
 */
export const ISSUE_EVENT_FIELDS = `created: issues(first:50,${NEWEST}){nodes{number title createdAt ${AUTHOR}}}`
  + ` newestPr: pullRequests(first:1,${NEWEST}){nodes{number}}`
  + ` updated: issues(first:50,${UPDATED}){nodes{number comments(last:20){nodes{databaseId body url createdAt ${AUTHOR}}}}}`
  + ` updatedPrs: pullRequests(first:50,${UPDATED}){nodes{comments(last:20){nodes{createdAt}}}}`

/**
 * How far back news goes: the fifty newest issues and PRs, and the fifty newest comments on either,
 * as the REST lists gave them. An older one isn't news, also when it was never reported: an old issue
 * or comment that only now comes up (a label added) would be reported long after the fact.
 */
const WINDOW = 50

/** Newest first; GitHub's timestamps all have one format, so their text sorts by time. */
const byNewest = (first: Json, second: Json) => textOf(second.createdAt).localeCompare(textOf(first.createdAt))

/** The numbers of the nodes of a connection in the answer. */
const numbers = (repository: Json, connection: string) => records(at(repository, connection, 'nodes')).map(node => count(node.number))

/** The newest issues among the fifty newest issues and PRs (they share their numbers), not the agent's own. */
const newIssues = (repository: Json, self: string): IssueEvent[] => {
  const oldest = Math.max(0, ...numbers(repository, 'created'), ...numbers(repository, 'newestPr')) - WINDOW
  return records(at(repository, 'created', 'nodes')).filter(issue => count(issue.number) > oldest && actor(issue.author) !== self)
    .map(issue => ({ at: issue.createdAt, key: `issue #${count(issue.number)}`, lines: [`NEW_ISSUE #${count(issue.number)} ${oneLine(issue.title, 200)}`] }))
}

/** Each comment on the issues or PRs read, with its issue's number. */
const commentsOn = (repository: Json, connection: string): Json[] =>
  records(at(repository, connection, 'nodes')).flatMap(issue => records(at(issue, 'comments', 'nodes')).map(comment => ({ ...comment, issue: count(issue.number) })))

/** When the oldest of the fifty newest comments on issues and PRs was written; '' with fewer than fifty. */
const windowStart = (repository: Json): string =>
  textOf([...commentsOn(repository, 'updated'), ...commentsOn(repository, 'updatedPrs')].toSorted(byNewest).at(WINDOW - 1)?.createdAt)

/** The owner's comments on issues, among the fifty newest comments on issues and PRs. */
const ownerComments = (repository: Json, owner: string): IssueEvent[] => {
  const start = windowStart(repository)
  return commentsOn(repository, 'updated').filter(comment => actor(comment.author) === owner && textOf(comment.createdAt) >= start)
    .toSorted(byNewest)
    .map(comment => ({
      at: comment.createdAt,
      key: `issue-comment ${count(comment.databaseId)}`,
      lines: [`ISSUE_COMMENT ${count(comment.databaseId)} #${count(comment.issue)}:`, ...commentText(comment, { author: owner, owner })],
    }))
}

/**
 * New issues (not the agent's own) and the owner's comments on issues, newest first, from
 * `ISSUE_EVENT_FIELDS`, each remembered by its id, never its text (#247). A comment comes whole,
 * under its event line (#255).
 */
export const issueEventsFrom = (repository: Json, { owner, self }: { owner: string, self: string }): IssueEvent[] =>
  [...newIssues(repository, self), ...ownerComments(repository, owner)]
