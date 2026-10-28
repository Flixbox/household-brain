/** The project watcher's questions to GitHub about new issues and the owner's comments on them. */
import { OWNER, REPO, SELF, gh, login } from './watch-github'
import { commentText } from './watch-comment-lines'
import { count, oneLine, record, records } from './watch-text'
import { textOf } from './read'

/**
 * New issues (not the agent's own) and the owner's comments on issues, newest first, each with when
 * it was written and the key it is remembered by: its id, never its text (#247). A comment comes
 * whole, under its event line (#255).
 */
export const issueEventLines = async (): Promise<{ at: unknown, key: string, lines: string[] }[]> => {
  const [issues, comments] = await Promise.all([
    gh(['api', `repos/${REPO}/issues?state=all&per_page=50&sort=created&direction=desc`]),
    gh(['api', `repos/${REPO}/issues/comments?per_page=50&sort=created&direction=desc`]),
  ])
  return [
    ...records(issues).filter(issue => (issue.pull_request ?? null) === null && textOf(record(issue.user).login) !== SELF)
      .map(issue => ({ at: issue.created_at, key: `issue #${count(issue.number)}`, lines: [`NEW_ISSUE #${count(issue.number)} ${oneLine(issue.title, 200)}`] })),
    ...records(comments).filter(comment => login(comment) === OWNER && textOf(comment.html_url).includes('/issues/'))
      .map(comment => ({ at: comment.created_at, key: `issue-comment ${count(comment.id)}`, lines: [`ISSUE_COMMENT ${count(comment.id)} #${textOf(comment.issue_url).split('/').at(-1) ?? ''}:`, ...commentText(comment, { author: login(comment), owner: OWNER })] })),
  ]
}
