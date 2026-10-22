/** What the watcher reports about issues opening and closing, decided from what GitHub answered (pure, so it is tested). */
import { textOf } from './read'
import { type Json, count, oneLine, record, records } from './watch-text'

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
