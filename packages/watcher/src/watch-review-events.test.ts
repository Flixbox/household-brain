import { describe, expect, it } from 'bun:test'
import { type Review, type ReviewThread, blockedByReviewEvent } from './watch-review-events'

const HEAD = 'abcdef1234567890abcdef1234567890abcdef12'
const OLD = '1234567890abcdef1234567890abcdef12345678'
const SELF = 'agent[bot]'
const thread = (id: string, changes: Partial<ReviewThread> = {}): ReviewThread =>
  ({ id, lastAuthor: SELF, resolved: false, url: `https://github.test/pr/1#${id}`, ...changes })
const review = (login: string, state: string, commit = HEAD): Review => ({ commit, login, state })
const event = (threads: ReviewThread[], reviews: Review[] = []) => blockedByReviewEvent({ head: HEAD, pr: 7, reviews, self: SELF, threads })

describe('blockedByReviewEvent', () => {
  it('names each open thread the agent answered last, with its link', () => {
    expect(event([thread('T2'), thread('T1'), thread('T3', { resolved: true }), thread('T4', { lastAuthor: 'reviewer[bot]' })])).toEqual({
      key: `pr-7 blocked-by-review ${HEAD} T1 T2`,
      lines: [
        'BLOCKED_BY_REVIEW: approved and CI is green at abcdef1, but review blocks the merge:',
        '  answered, not resolved: https://github.test/pr/1#T2',
        '  answered, not resolved: https://github.test/pr/1#T1',
      ],
    })
  })

  it('names each reviewer whose latest counting review requests changes on an older commit', () => {
    const blocked = event([], [
      review('reviewer[bot]', 'CHANGES_REQUESTED', OLD),
      review('reviewer[bot]', 'COMMENTED'),
      review('other', 'CHANGES_REQUESTED', OLD),
      review('other', 'APPROVED'),
      review('current', 'CHANGES_REQUESTED'),
    ])
    expect(blocked?.key).toBe(`pr-7 blocked-by-review ${HEAD} reviewer[bot]@${OLD}`)
    expect(blocked?.lines.slice(1)).toEqual(['  reviewer[bot] requested changes on an older commit (1234567): ask the owner to dismiss it'])
  })

  it('is null when neither blocks it, and without SELF no thread counts as answered', () => {
    expect(event([thread('T1', { resolved: true })], [review('owner', 'APPROVED')])).toBeNull()
    expect(blockedByReviewEvent({ head: HEAD, pr: 7, reviews: [], self: '', threads: [thread('T1', { lastAuthor: '' })] })).toBeNull()
  })
})
