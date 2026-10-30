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
 * query, so the cycle check costs no extra call. A blocker in another repository is left out.
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
 * the times of the fifty newest PRs, and the comments on the fifty issues and PRs updated last (a new
 * comment updates its issue): an issue's last twenty, and only the times of a PR's last fifty, so
 * that one busy PR can't hide where the fifty newest comments start. Issues and PRs come in every
 * state: GraphQL's connections filter by state only when asked to.
 */
export const ISSUE_EVENT_FIELDS = `created: issues(first:50,${NEWEST}){nodes{number title createdAt ${AUTHOR}}}`
  + ` createdPrs: pullRequests(first:50,${NEWEST}){nodes{createdAt}}`
  + ` updated: issues(first:50,${UPDATED}){nodes{number comments(last:20){nodes{databaseId body url createdAt ${AUTHOR}}}}}`
  + ` updatedPrs: pullRequests(first:50,${UPDATED}){nodes{comments(last:50){nodes{createdAt}}}}`

/**
 * How far back news goes: the fifty newest issues and PRs, and the fifty newest comments on either,
 * as the REST lists gave them. An older one isn't news, also when it was never reported: an old issue
 * or comment that only now comes up (a label added) would be reported long after the fact.
 */
const WINDOW = 50

/** Newest first; GitHub's timestamps all have one format, so their text sorts by time. */
const byNewest = (first: Json, second: Json) => textOf(second.createdAt).localeCompare(textOf(first.createdAt))

/** Those of `onIssues` (issues, or comments on them) among the fifty newest of them and `onPrs`. */
const newest = (onIssues: Json[], onPrs: Json[]): Json[] => {
  const kept = new Set([...onIssues, ...onPrs].toSorted(byNewest).slice(0, WINDOW))
  return onIssues.filter(item => kept.has(item))
}

/** The newest issues among the fifty newest issues and PRs, not the agent's own. */
const newIssues = (repository: Json, self: string): IssueEvent[] =>
  newest(records(at(repository, 'created', 'nodes')), records(at(repository, 'createdPrs', 'nodes')))
    .filter(issue => actor(issue.author) !== self)
    .map(issue => ({ at: issue.createdAt, key: `issue #${count(issue.number)}`, lines: [`NEW_ISSUE #${count(issue.number)} ${oneLine(issue.title, 200)}`] }))

/** Each comment on the issues read, with its issue's number. */
const issueOfComments = (repository: Json): Map<Json, number> => {
  const issues = records(at(repository, 'updated', 'nodes'))
  return new Map(issues.flatMap(issue => records(at(issue, 'comments', 'nodes')).map((comment): [Json, number] => [comment, count(issue.number)])))
}

/** The owner's comments on issues, among the fifty newest comments on issues and PRs. */
const ownerComments = (repository: Json, owner: string): IssueEvent[] => {
  const issueOf = issueOfComments(repository)
  const onPrs = records(at(repository, 'updatedPrs', 'nodes')).flatMap(pr => records(at(pr, 'comments', 'nodes')))
  return newest([...issueOf.keys()], onPrs).filter(comment => actor(comment.author) === owner)
    .map(comment => ({
      at: comment.createdAt,
      key: `issue-comment ${count(comment.databaseId)}`,
      lines: [`ISSUE_COMMENT ${count(comment.databaseId)} #${issueOf.get(comment) ?? 0}:`, ...commentText(comment, { author: owner, owner })],
    }))
}

/**
 * New issues (not the agent's own) and the owner's comments on issues, newest first, from
 * `ISSUE_EVENT_FIELDS`, each remembered by its id, never its text (#247). A comment comes whole,
 * under its event line (#255).
 */
export const issueEventsFrom = (repository: Json, { owner, self }: { owner: string, self: string }): IssueEvent[] =>
  [...newIssues(repository, self), ...ownerComments(repository, owner)]
