/** What the watcher reports about issues opening and closing, decided from what GitHub answered (pure, so it is tested). */
import { type Json, actor, at, count, oneLine, record, records } from './watch-text'
import { commentText } from './watch-comment-lines'
import type { OpenIssue } from './watch-link-cycles'
import { textOf } from './read'

/** One page of open issues: each with its blockers, and the cursor of the next page (null on the last). */
export interface IssuePage {
  issues: OpenIssue[]
  next: string | null
}

/**
 * The open issues' fields: with each, the issues it is blocked by (#335), for LINK_CYCLE, in the same
 * query, so the cycle check costs no extra call. A blocker in another repository is left out. GitHub
 * lets an issue have at most fifty blockers, so the first fifty are all of them.
 */
export const OPEN_ISSUE_FIELDS = 'number blockedBy(first:50){nodes{number repository{nameWithOwner}}}'

/** The issues `issue` is blocked by in `repo`. */
const blockersIn = (issue: Json, repo: string): number[] =>
  records(at(issue, 'blockedBy', 'nodes'))
    .filter(blocker => textOf(record(blocker.repository).nameWithOwner).toLowerCase() === repo.toLowerCase())
    .map(blocker => count(blocker.number))

/**
 * A page of GraphQL's `issues` connection. An answer without `pageInfo` is a failed one, not an empty
 * last page: a list cut short would report every issue past it as closed (#261).
 */
export const issuePage = (connection: unknown, repo: string): IssuePage => {
  const { nodes, pageInfo } = record(connection)
  const info = record(pageInfo)
  if (!Array.isArray(nodes) || typeof info.hasNextPage !== 'boolean') {
    throw new TypeError('GitHub answered no page of open issues')
  }
  const next = textOf(info.endCursor)
  if (info.hasNextPage && next === '') {
    throw new Error('GitHub gave no cursor for the next page of open issues')
  }
  return { issues: records(nodes).map(node => ({ blockedBy: blockersIn(node, repo), number: count(node.number) })), next: info.hasNextPage ? next : null }
}

/**
 * Every open issue, page by page through GraphQL's cursors (#261): GitHub's REST list stopped after
 * its first hundred open issues. Any page failing fails the whole list.
 */
export const allOpenIssues = async (page: (cursor: string | null) => Promise<IssuePage>, cursor: string | null = null): Promise<OpenIssue[]> => {
  const { issues, next } = await page(cursor)
  return next === null ? issues : [...issues, ...await allOpenIssues(page, next)]
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
  issue: number
  at: unknown
  key: string
  lines: string[]
}

const AUTHOR = 'author{login kind:__typename}'
const ISSUE_COMMENTS = `comments(last:20){nodes{databaseId body url createdAt ${AUTHOR}}}`
/** The event for the owner's `comment` on `issue`, remembered by its id. */
export const commentEvent = (comment: Json, issue: number, owner: string): IssueEvent => ({
  at: comment.createdAt,
  issue,
  key: `issue-comment ${count(comment.databaseId)}`,
  lines: [`ISSUE_COMMENT ${count(comment.databaseId)} #${issue}:`, ...commentText(comment, { author: owner, owner })],
})

/**
 * What a scoped watcher reads of each subscribed issue (#357): its last twenty comments, instead of
 * the repository's newest issues and comments.
 */
export const SUBSCRIBED_ISSUE_FIELDS = ISSUE_COMMENTS

/** The owner's comments on the subscribed issues, from each one's `SUBSCRIBED_ISSUE_FIELDS`. */
export const subscribedIssueEventsFrom = (issues: ReadonlyMap<number, Json>, owner: string): IssueEvent[] =>
  [...issues].flatMap(([issue, value]) => records(at(value, 'comments', 'nodes'))
    .filter(comment => actor(comment.author) === owner)
    .map(comment => commentEvent(comment, issue, owner)))
