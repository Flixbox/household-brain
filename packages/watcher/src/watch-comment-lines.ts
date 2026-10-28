/** How the project watcher prints comments and reviews (pure, so it is tested). */
import { type Activity, clockTime } from './watch-events'
import { type Json, actor, at, bodyLines, count, records } from './watch-text'
import { isRecord, textOf } from './read'

/** Who wrote a comment or review, and when (#240): `Flixbox at 12:09:20`. */
export const byline = (author: string, when: unknown): string => `${author} at ${clockTime(when) ?? '?'}`

/** The text of a comment or review: whole when it is the owner's (#255). */
export const commentText = (item: Json, { author, indent = '    ', owner }: { author: string, indent?: string, owner: string }): string[] =>
  bodyLines(item.body, { indent, url: item.html_url ?? item.url, whole: author === owner })

const AUTHOR = 'author{login kind:__typename}'
/**
 * A PR's comments and its reviews, each review with its line comments, as GraphQL names them (#306):
 * the last hundred comments and reviews, which leaves out only old news.
 */
export const ACTIVITY_FIELDS = `comments(last:100){nodes{databaseId body url createdAt ${AUTHOR}}}`
  + ` reviews(last:100){nodes{databaseId body url state createdAt submittedAt ${AUTHOR}`
  + ` comments(first:100){nodes{databaseId body url createdAt path line originalLine replyTo{databaseId} ${AUTHOR}}}}}`

/** The line a review comment is on; one on an outdated diff only has its original line. */
const lineOf = (item: Json) => [item.line, item.originalLine].find((value): value is number => typeof value === 'number')

interface People {
  /** Whose comments are no news: the agent's own and other bots' status comments. */
  ignored: ReadonlySet<string>
  /** Whose comments come whole. */
  owner: string
  /** The agent's own login: its replies in review threads and its plain reviews are no news. */
  self: string
}

/**
 * Comments, reviews (not plain approvals) and review comments on a PR, from its `ACTIVITY_FIELDS`,
 * the agent's own left out. A review's line comments come under it, as `path:line:`.
 */
export const activityFrom = (pr: Json, { ignored, owner, self }: People): Activity[] => {
  const text = (item: Json, indent?: string) => commentText(item, { author: actor(item.author), indent, owner })
  const by = (item: Json) => byline(actor(item.author), item.submittedAt ?? item.createdAt)
  const reviews = records(at(pr, 'reviews', 'nodes'))
  const reviewComments = reviews.flatMap(review => records(at(review, 'comments', 'nodes')))
    .toSorted((first, second) => count(first.databaseId) - count(second.databaseId))
  return [
    ...records(at(pr, 'comments', 'nodes')).filter(item => !ignored.has(actor(item.author)))
      .map(item => ({ id: `comment ${count(item.databaseId)}`, lines: [`comment ${count(item.databaseId)} ${by(item)}:`, ...text(item)] })),
    ...reviews.filter(item => (item.state !== 'APPROVED' || textOf(item.body) !== '') && (actor(item.author) !== self || textOf(item.body) !== ''))
      .map(item => ({
        id: `review ${count(item.databaseId)}`,
        lines: [`review ${count(item.databaseId)} ${by(item)} ${textOf(item.state)}:`, ...text(item),
          ...records(at(item, 'comments', 'nodes')).flatMap(comment => [`  ${textOf(comment.path)}:${lineOf(comment) ?? 'file'}:`, ...text(comment, '      ')])],
      })),
    ...reviewComments.filter(item => actor(item.author) !== self || !isRecord(item.replyTo))
      .map(item => ({ id: `review-comment ${count(item.databaseId)}`, lines: [`review-comment ${count(item.databaseId)} ${by(item)} ${textOf(item.path)}:`, ...text(item)] })),
  ]
}
