/** The project watcher's questions to GitHub about new issues and the owner's comments on them. */
import { type IssueEvent, SUBSCRIBED_ISSUE_FIELDS, subscribedIssueEventsFrom } from './watch-issue-events'
import { type Rest, commentsBase, isCursor, issuesBase, newIssueEvents, nextCursor, ownerCommentEvents, readSince } from './watch-issue-rest'
import { perIssue } from './watch-per-issue'
import { OWNER, REPO, SELF } from './watch-github'
import { GH, ghRest } from './watch-gh'
import { readLines, writeLines, writtenAt } from './watch-state'
import { type Json, record } from './watch-text'

/** What a look found, and how to remember that it was handled: only once it has been, so a crash reads it again. */
export interface IssueEventRead {
  commit: () => Promise<void>
  events: IssueEvent[]
}

const CURSORS = 'issue-event-cursors'

const savedCursors = async (): Promise<Json> => {
  const [line = '{}'] = await readLines(CURSORS)
  try {
    return record(JSON.parse(line))
  } catch {
    return {}
  }
}

/**
 * Where a watcher without a stored cursor starts: the last time it wrote down what it had seen, so
 * what came while it was being upgraded still reports. Null on the very first look.
 */
const lastSeen = async (): Promise<string | null> => {
  const written = await writtenAt('issue-events')
  return written === null ? null : Temporal.Instant.fromEpochMilliseconds(written).toString()
}

/**
 * New issues (not the agent's own) and the owner's comments on issues, each with when it was written
 * and the key it is remembered by, through REST with `since=` (#412).
 */
export const issueEventLines = async (fresh = false): Promise<IssueEventRead> => {
  const [saved, fallback] = await Promise.all([savedCursors(), lastSeen()])
  const issuesFrom = isCursor(saved.issues) ? saved.issues : fallback
  const commentsFrom = isCursor(saved.comments) ? saved.comments : fallback
  const rest: Rest = async path => ghRest(path, GH, fresh)
  const [issues, comments] = await Promise.all([readSince(rest, issuesBase(REPO), issuesFrom), readSince(rest, commentsBase(REPO), commentsFrom)])
  return {
    commit: async () => writeLines(CURSORS, [JSON.stringify({ comments: nextCursor(commentsFrom, comments), issues: nextCursor(issuesFrom, issues) })]),
    events: [...newIssueEvents(issues.flat(), SELF, issuesFrom), ...ownerCommentEvents(comments.flat(), OWNER, commentsFrom)],
  }
}

/**
 * The owner's comments on a scoped watcher's subscribed issues (#357), read from those issues alone
 * (one that can't be read is left out this look); none asked for, none read.
 */
export const subscribedIssueEvents = async (issues: readonly number[], fresh = false): Promise<IssueEvent[]> =>
  subscribedIssueEventsFrom(await perIssue(issues, SUBSCRIBED_ISSUE_FIELDS, fresh), OWNER)
