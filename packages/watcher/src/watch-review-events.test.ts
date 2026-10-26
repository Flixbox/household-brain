import { describe, expect, it } from 'bun:test'
import { type Review, type ReviewThread, blockedByReviewEvent, dismissedReviewEvent, resolvedThreadEvent, reviewsToDismiss, threadsToResolve } from './watch-review-events'

const HEAD = 'abcdef1234567890abcdef1234567890abcdef12'
const OLD = '1234567890abcdef1234567890abcdef12345678'
const SELF = 'agent[bot]'
const thread = (id: string, changes: Partial<ReviewThread> = {}): ReviewThread =>
  ({ id, lastAuthor: SELF, lastBody: 'Fixed in the next push.', resolved: false, url: `https://github.test/pr/1#${id}`, ...changes })
const review = (login: string, state: string, commit = HEAD, id = 1): Review => ({ commit, id, login, state })
const event = (threads: ReviewThread[], reviews: Review[] = []) => blockedByReviewEvent({ head: HEAD, pr: 7, reviews, self: SELF, threads })

describe('blockedByReviewEvent', () => {
  it('names each open thread the agent answered last, with its link', () => {
    expect(event([thread('T2'), thread('T1'), thread('T3', { resolved: true }), thread('T4', { lastAuthor: 'reviewer[bot]' })])).toEqual({
      key: `pr-7 blocked-by-review ${HEAD} T1 T2`,
      lines: [
        'BLOCKED_BY_REVIEW: approved and CI is green at abcdef1, but review blocks the merge:',
        '  answered, not resolved: https://github.test/pr/1#T2 (if settled, reply `Resolved: <reason>`)',
        '  answered, not resolved: https://github.test/pr/1#T1 (if settled, reply `Resolved: <reason>`)',
      ],
    })
  })

  it('leaves out a thread that already asks to be resolved: the watcher resolves it', () => {
    expect(event([thread('T1', { lastBody: 'Resolved: fixed in abc1234' })])).toBeNull()
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

describe('threadsToResolve', () => {
  it('takes each open thread whose last comment is a `Resolved: <reason>` reply, from anyone', () => {
    const threads = [
      thread('T1', { lastBody: 'Resolved: fixed in abc1234' }),
      thread('T2', { lastAuthor: 'owner', lastBody: '  Resolved:done' }),
      thread('T3', { lastBody: 'Resolved: fixed', resolved: true }),
      thread('T4', { lastBody: 'Resolved:' }),
      thread('T5', { lastBody: 'resolved: lower case is no request' }),
      thread('T6', { lastBody: 'Not yet. Resolved: later' }),
    ]
    expect(threadsToResolve(threads).map(each => each.id)).toEqual(['T1', 'T2'])
  })
})

describe('resolvedThreadEvent', () => {
  it('reports a resolved thread, and a failed attempt under its own key', () => {
    expect(resolvedThreadEvent(7, thread('T1'), true)).toEqual({
      key: 'pr-7 thread-resolved T1',
      lines: ['THREAD_RESOLVED: resolved on its `Resolved:` reply: https://github.test/pr/1#T1'],
    })
    expect(resolvedThreadEvent(7, thread('T1'), false).key).toBe('pr-7 thread-resolve-failed T1')
  })
})

describe('reviewsToDismiss', () => {
  const dismiss = (reviews: Review[], threads: ReviewThread[] = []) => reviewsToDismiss({ head: HEAD, reviews, threads }).map(each => each.id)

  it('takes every change request on an older commit from a bot whose latest counting review is one', () => {
    expect(dismiss([
      review('reviewer[bot]', 'CHANGES_REQUESTED', OLD, 1),
      review('reviewer[bot]', 'CHANGES_REQUESTED', OLD, 2),
      review('reviewer[bot]', 'COMMENTED', HEAD, 3),
      review('person', 'CHANGES_REQUESTED', OLD, 4),
      review('fixed[bot]', 'CHANGES_REQUESTED', OLD, 5),
      review('fixed[bot]', 'APPROVED', HEAD, 6),
      review('current[bot]', 'CHANGES_REQUESTED', HEAD, 7),
      review('owner', 'APPROVED', HEAD, 8),
    ])).toEqual([1, 2])
  })

  it('takes none while a review thread is open', () => {
    expect(dismiss([review('reviewer[bot]', 'CHANGES_REQUESTED', OLD)], [thread('T1', { resolved: true }), thread('T2')])).toEqual([])
    expect(dismiss([review('reviewer[bot]', 'CHANGES_REQUESTED', OLD)], [thread('T1', { resolved: true })])).toEqual([1])
  })
})

describe('dismissedReviewEvent', () => {
  it('reports a dismissed change request, and a failed attempt under its own key', () => {
    expect(dismissedReviewEvent(7, review('reviewer[bot]', 'CHANGES_REQUESTED', OLD, 42), true)).toEqual({
      key: 'pr-7 review-dismissed 42',
      lines: ["REVIEW_DISMISSED: dismissed reviewer[bot]'s change request on an older commit (1234567): the owner approved, and no review thread is open"],
    })
    expect(dismissedReviewEvent(7, review('reviewer[bot]', 'CHANGES_REQUESTED', OLD, 42), false).key).toBe('pr-7 review-dismiss-failed 42')
  })
})
