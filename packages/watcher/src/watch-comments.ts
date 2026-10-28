/** The project watcher's questions to GitHub about new issues and the owner's comments on them. */
import { ISSUE_EVENT_FIELDS, type IssueEvent, issueEventsFrom } from './watch-issue-events'
import { OWNER, SELF, graphql } from './watch-github'

/**
 * New issues (not the agent's own) and the owner's comments on issues, newest first, each with when
 * it was written and the key it is remembered by (see `issueEventsFrom`). One GraphQL query (#314).
 */
export const issueEventLines = async (): Promise<IssueEvent[]> => issueEventsFrom(await graphql(ISSUE_EVENT_FIELDS), { owner: OWNER, self: SELF })
