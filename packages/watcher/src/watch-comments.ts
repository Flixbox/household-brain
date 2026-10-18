/** The project watcher's questions to GitHub about comments: on pull requests, in reviews and on issues. */
import { ACTIVITY_GH, IGNORED, OWNER, REPO, SELF, allPages, gh, login } from './watch-github'
import { type Activity, clockTime } from './watch-events'
import { type Json, bodyLines, count, oneLine, record, records } from './watch-text'
import { textOf } from './read'

/** Who wrote a comment or review, and when (#240): `Flixbox at 12:09:20`. */
const byline = (item: Json) => `${login(item)} at ${clockTime(item.created_at ?? item.submitted_at) ?? '?'}`

/** The text of a comment or review: whole when it is the owner's (#255). */
const commentText = (item: Json, indent = '    ') => bodyLines(item.body, { indent, url: item.html_url, whole: login(item) === OWNER })

/** The line a review comment is on; one on an outdated diff only has its original line. */
const lineOf = (item: Json) => [item.line, item.original_line].find((value): value is number => typeof value === 'number')

/** Comments, reviews (not plain approvals) and review comments on a PR, the agent's own left out. */
export const activityOf = async (pr: number): Promise<Activity[]> => {
  const [comments, reviews, reviewComments] = await Promise.all([
    allPages(`repos/${REPO}/issues/${pr}/comments`, ACTIVITY_GH),
    allPages(`repos/${REPO}/pulls/${pr}/reviews`, ACTIVITY_GH),
    allPages(`repos/${REPO}/pulls/${pr}/comments`, ACTIVITY_GH),
  ])
  return [
    ...comments.filter(item => !IGNORED.has(login(item)))
      .map(item => ({ id: `comment ${count(item.id)}`, lines: [`comment ${count(item.id)} ${byline(item)}:`, ...commentText(item)] })),
    ...reviews.filter(item => (item.state !== 'APPROVED' || textOf(item.body) !== '') && (login(item) !== SELF || textOf(item.body) !== ''))
      .map(item => ({ id: `review ${count(item.id)}`, lines: [`review ${count(item.id)} ${byline(item)} ${textOf(item.state)}:`, ...commentText(item)] })),
    ...reviewComments.filter(item => login(item) !== SELF || (item.in_reply_to_id ?? null) === null)
      .map(item => ({ id: `review-comment ${count(item.id)}`, lines: [`review-comment ${count(item.id)} ${byline(item)} ${textOf(item.path)}:`, ...commentText(item)] })),
  ]
}

/** A review's own comments; a pending review's are only visible to its author (the owner's login). */
export const reviewCommentLines = async (pr: number, review: string): Promise<string[]> =>
  records(await gh(['api', `repos/${REPO}/pulls/${pr}/reviews/${review}/comments`], ACTIVITY_GH))
    .flatMap(item => [`  ${textOf(item.path)}:${lineOf(item) ?? 'file'}:`].concat(commentText(item, '      ')))

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
      .map(comment => ({ at: comment.created_at, key: `issue-comment ${count(comment.id)}`, lines: [`ISSUE_COMMENT ${count(comment.id)} #${textOf(comment.issue_url).split('/').at(-1) ?? ''}:`, ...commentText(comment)] })),
  ]
}
