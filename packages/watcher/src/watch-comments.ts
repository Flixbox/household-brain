/** The project watcher's questions to GitHub about new issues and the owner's comments on them. */
import { ISSUE_EVENT_FIELDS, type IssueEvent, issueEventsFrom, subscribedIssueEventsFrom, subscribedIssueFields } from './watch-issue-events'
import { OWNER, SELF, graphql } from './watch-github'

/**
 * New issues (not the agent's own) and the owner's comments on issues, newest first, each with when
 * it was written and the key it is remembered by (see `issueEventsFrom`). One GraphQL query (#314).
 */
export const issueEventLines = async (fresh = false): Promise<IssueEvent[]> => issueEventsFrom(await graphql(ISSUE_EVENT_FIELDS, fresh), { owner: OWNER, self: SELF })

/**
 * The owner's comments on a scoped watcher's subscribed issues (#357), read from those issues alone;
 * none asked for, none read.
 */
export const subscribedIssueEvents = async (issues: readonly number[], fresh = false): Promise<IssueEvent[]> =>
  issues.length === 0 ? [] : subscribedIssueEventsFrom(await graphql(subscribedIssueFields(issues), fresh), issues, OWNER)
