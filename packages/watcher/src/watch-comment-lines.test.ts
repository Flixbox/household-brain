import { describe, expect, it } from 'bun:test'
import { activityFrom, byline } from './watch-comment-lines'

const AT = '2026-10-28T10:00:00Z'
const PEOPLE = { ignored: new Set(['agent[bot]', 'nx-cloud[bot]']), owner: 'owner', self: 'agent[bot]' }
const user = (login: string) => ({ kind: 'User', login })
const bot = (login: string) => ({ kind: 'Bot', login })
const nodes = (...items: object[]) => ({ nodes: items })
const lineComment = (databaseId: number, changes: object = {}) =>
  ({ author: user('owner'), body: 'Rename this.', createdAt: AT, databaseId, line: 12, originalLine: 10, path: 'src/a.ts', replyTo: null, url: `https://github.test/c${databaseId}`, ...changes })

describe('activityFrom (#306)', () => {
  it('reads comments, reviews with their line comments, and review comments from GraphQL, the agent\'s own left out', () => {
    const pr = {
      comments: nodes(
        { author: user('owner'), body: 'Looks good.\nOne more thing.', createdAt: AT, databaseId: 1, url: 'https://github.test/1' },
        { author: bot('nx-cloud'), body: 'Status', createdAt: AT, databaseId: 2, url: 'https://github.test/2' },
        { author: bot('agent'), body: 'Done.', createdAt: AT, databaseId: 3, url: 'https://github.test/3' },
      ),
      reviews: nodes(
        { author: user('owner'), body: '', comments: nodes(lineComment(21), lineComment(20, { line: null })), createdAt: AT, databaseId: 10, state: 'CHANGES_REQUESTED', submittedAt: AT, url: 'https://github.test/10' },
        { author: user('owner'), body: '', comments: nodes(), createdAt: AT, databaseId: 11, state: 'APPROVED', submittedAt: AT, url: 'https://github.test/11' },
        { author: bot('agent'), body: '', comments: nodes(lineComment(22, { author: bot('agent'), replyTo: { databaseId: 21 } })), createdAt: AT, databaseId: 12, state: 'COMMENTED', submittedAt: AT, url: 'https://github.test/12' },
        { author: user('owner'), body: 'Pending', comments: nodes(), createdAt: AT, databaseId: 13, state: 'PENDING', submittedAt: null, url: 'https://github.test/13' },
      ),
    }
    const by = byline('owner', AT)
    expect(activityFrom(pr, PEOPLE)).toEqual([
      { id: 'comment 1', lines: [`comment 1 ${by}:`, '    Looks good.', '    One more thing.'] },
      { id: 'review 10', lines: [`review 10 ${by} CHANGES_REQUESTED:`, '  src/a.ts:12:', '      Rename this.', '  src/a.ts:10:', '      Rename this.'] },
      { id: 'review 13', lines: [`review 13 ${by} PENDING:`, '    Pending'] },
      { id: 'review-comment 20', lines: [`review-comment 20 ${by} src/a.ts:`, '    Rename this.'] },
      { id: 'review-comment 21', lines: [`review-comment 21 ${by} src/a.ts:`, '    Rename this.'] },
    ])
  })

  it('cuts someone else\'s text and keeps the agent\'s own top-level review comment', () => {
    const long = 'x'.repeat(301)
    const pr = { reviews: nodes({ author: bot('agent'), body: '', comments: nodes(lineComment(30, { author: bot('agent'), body: long })), createdAt: AT, databaseId: 14, state: 'COMMENTED', submittedAt: AT }) }
    expect(activityFrom(pr, PEOPLE)).toEqual([
      { id: 'review-comment 30', lines: [`review-comment 30 ${byline('agent[bot]', AT)} src/a.ts:`, `    ${'x'.repeat(300)} … [1 more characters: https://github.test/c30]`] },
    ])
  })
})
