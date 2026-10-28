import { describe, expect, it } from 'bun:test'
import { type PrComment, type Review, type ReviewThread, approvedEvent, blockedByReviewEvent, dismissalMessage, dismissedReviewEvent, resolvedThreadEvent, reviewsToDismiss, threadsToResolve } from './watch-review-events'

const HEAD = 'abcdef1234567890abcdef1234567890abcdef12'
const OLD = '1234567890abcdef1234567890abcdef12345678'
const SELF = 'agent[bot]'
const thread = (id: string, changes: Partial<ReviewThread> = {}): ReviewThread =>
  ({ id, lastAuthor: SELF, lastBody: 'Fixed in the next push.', resolved: false, review: 0, url: `https://github.test/pr/1#${id}`, ...changes })
const review = (login: string, state: string, { commit = HEAD, id = 1, submittedAt = '2026-10-26T10:00:00Z' }: Partial<Pick<Review, 'commit' | 'id' | 'submittedAt'>> = {}): Review =>
  ({ commit, id, login, state, submittedAt })
const comment = (author: string, body: string, createdAt = '2026-10-26T11:00:00Z'): PrComment => ({ author, body, createdAt, url: 'https://github.test/pr/1#c' })
const event = (threads: ReviewThread[], reviews: Review[] = [], dismiss = true) => blockedByReviewEvent({ dismiss, head: HEAD, pr: 7, reviews, self: SELF, threads })

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

  it('names each reviewer whose latest counting review requests changes, on an older commit or the head', () => {
    const blocked = event([], [
      review('reviewer[bot]', 'CHANGES_REQUESTED', { commit: OLD }),
      review('reviewer[bot]', 'COMMENTED'),
      review('other', 'CHANGES_REQUESTED', { commit: OLD }),
      review('other', 'APPROVED'),
      review('current', 'CHANGES_REQUESTED'),
      review('head[bot]', 'CHANGES_REQUESTED'),
    ])
    expect(blocked?.key).toBe(`pr-7 blocked-by-review ${HEAD} current@${HEAD} head[bot]@${HEAD} reviewer[bot]@${OLD}`)
    expect(blocked?.lines.slice(1)).toEqual([
      '  reviewer[bot] requested changes on an older commit (1234567): ask the owner to dismiss it',
      '  current requested changes on the head (abcdef1): ask the owner to dismiss it',
      '  head[bot] requested changes on the head (abcdef1): once its points are dealt with, reply `Resolved: <reason>` in each of its threads (on the PR when it has none), or ask the owner to dismiss it',
    ])
  })

  it('leaves a bot\'s change request on the head to the owner while dismissing is off', () => {
    expect(event([], [review('head[bot]', 'CHANGES_REQUESTED')], false)?.lines.slice(1)).toEqual([
      '  head[bot] requested changes on the head (abcdef1): ask the owner to dismiss it',
    ])
  })

  it('is null when neither blocks it, and without SELF no thread counts as answered', () => {
    expect(event([thread('T1', { resolved: true })], [review('owner', 'APPROVED')])).toBeNull()
    expect(blockedByReviewEvent({ dismiss: true, head: HEAD, pr: 7, reviews: [], self: '', threads: [thread('T1', { lastAuthor: '' })] })).toBeNull()
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
  const settlers = [SELF, 'Owner']
  const dismiss = (reviews: Review[], threads: ReviewThread[] = [], comments: PrComment[] = []) =>
    reviewsToDismiss({ comments, complete: true, head: HEAD, reviews, settlers, threads }).map(each => each.review.id)
  const settled = (id: string, changes: Partial<ReviewThread> = {}) => thread(id, { lastBody: `Resolved: fixed (${id})`, resolved: true, review: 9, ...changes })
  const onHead = review('coderabbit[bot]', 'CHANGES_REQUESTED', { id: 9 })

  it('takes every change request on an older commit from a bot whose latest counting review is one', () => {
    expect(dismiss([
      review('reviewer[bot]', 'CHANGES_REQUESTED', { commit: OLD, id: 1 }),
      review('reviewer[bot]', 'CHANGES_REQUESTED', { commit: OLD, id: 2 }),
      review('reviewer[bot]', 'COMMENTED', { id: 3 }),
      review('person', 'CHANGES_REQUESTED', { commit: OLD, id: 4 }),
      review('fixed[bot]', 'CHANGES_REQUESTED', { commit: OLD, id: 5 }),
      review('fixed[bot]', 'APPROVED', { id: 6 }),
      review('current[bot]', 'CHANGES_REQUESTED', { id: 7 }),
      review('owner', 'APPROVED', { id: 8 }),
    ])).toEqual([1, 2])
  })

  it('takes none while a review thread is open without a `Resolved:` reply', () => {
    expect(dismiss([review('reviewer[bot]', 'CHANGES_REQUESTED', { commit: OLD })], [thread('T1', { resolved: true }), thread('T2')])).toEqual([])
    expect(dismiss([review('reviewer[bot]', 'CHANGES_REQUESTED', { commit: OLD })], [thread('T1', { resolved: true })])).toEqual([1])
  })

  it('takes none when not every thread could be read', () => {
    expect(reviewsToDismiss({ comments: [], complete: false, head: HEAD, reviews: [review('reviewer[bot]', 'CHANGES_REQUESTED', { commit: OLD })], settlers, threads: [] })).toEqual([])
  })

  it('takes a bot\'s older change requests with its latest, but one on the head only when settled itself', () => {
    const older = review('coderabbit[bot]', 'CHANGES_REQUESTED', { commit: OLD, id: 8 })
    expect(dismiss([older, review('coderabbit[bot]', 'CHANGES_REQUESTED', { id: 9 }), review('coderabbit[bot]', 'CHANGES_REQUESTED', { commit: OLD, id: 10 })])).toEqual([8, 10])
    expect(dismiss([older, onHead, review('coderabbit[bot]', 'CHANGES_REQUESTED', { id: 10, submittedAt: '2026-10-26T12:00:00Z' })], [settled('T2', { review: 10 })])).toEqual([8, 10])
  })

  it('takes a bot\'s change request on the head once each of its threads ends in a `Resolved:` reply, quoting them', () => {
    const dismissals = reviewsToDismiss({ comments: [], complete: true, head: HEAD, reviews: [onHead], settlers, threads: [settled('T1'), settled('T2', { lastAuthor: 'owner', resolved: false }), thread('T3', { resolved: true })] })
    expect(dismissals).toEqual([{ replies: [{ body: 'Resolved: fixed (T1)', url: 'https://github.test/pr/1#T1' }, { body: 'Resolved: fixed (T2)', url: 'https://github.test/pr/1#T2' }], review: onHead }])
  })

  it('leaves a head change request with a thread not settled by the agent or the owner', () => {
    expect(dismiss([onHead], [settled('T1'), thread('T2', { resolved: true, review: 9 })])).toEqual([])
    expect(dismiss([onHead], [settled('T1'), settled('T2', { lastAuthor: 'passer-by' })])).toEqual([])
    expect(dismiss([onHead], [settled('T1'), settled('T2', { lastAuthor: 'coderabbit[bot]', lastBody: 'Still applies.', resolved: false })])).toEqual([])
  })

  it('takes a head change request without threads on a `Resolved:` comment on the PR made after it', () => {
    expect(dismiss([onHead], [], [comment(SELF, 'Resolved: the summary\'s points are fixed')])).toEqual([9])
    expect(dismiss([onHead], [], [comment(SELF, 'Resolved: too early', '2026-10-26T09:00:00Z')])).toEqual([])
    expect(dismiss([onHead], [], [comment('passer-by', 'Resolved: says who')])).toEqual([])
    expect(dismiss([onHead], [], [comment(SELF, 'Fixed, see above')])).toEqual([])
  })

  it('lets a newer review of the bot win: its own threads, or a reply after it, are needed', () => {
    const again = review('coderabbit[bot]', 'CHANGES_REQUESTED', { id: 10, submittedAt: '2026-10-26T12:00:00Z' })
    expect(dismiss([onHead, again], [settled('T1')])).toEqual([])
    expect(dismiss([onHead, again], [settled('T1')], [comment(SELF, 'Resolved: fixed')])).toEqual([])
    expect(dismiss([onHead, again], [settled('T1'), settled('T2', { review: 10 })])).toEqual([9, 10])
    expect(dismiss([onHead, review('coderabbit[bot]', 'DISMISSED', { id: 11 })], [settled('T1')])).toEqual([])
  })

  it('never takes a person\'s change request', () => {
    expect(dismiss([review('person', 'CHANGES_REQUESTED', { id: 9 })], [settled('T1')], [comment(SELF, 'Resolved: fixed')])).toEqual([])
    expect(dismiss([review('person', 'CHANGES_REQUESTED', { commit: OLD, id: 9 })])).toEqual([])
  })
})

describe('dismissalMessage', () => {
  it('quotes the `Resolved:` replies it relied on', () => {
    expect(dismissalMessage({ replies: [{ body: 'Resolved: fixed\nin abc1234', url: 'https://github.test/r1' }], review: review('coderabbit[bot]', 'CHANGES_REQUESTED') })).toBe(
      'Dismissed by the project watcher: the owner approved, and this change request was settled with `Resolved:` replies (DISMISS_STALE_BOT_REVIEWS):\n\n> Resolved: fixed in abc1234\n> https://github.test/r1',
    )
    expect(dismissalMessage({ replies: [], review: review('reviewer[bot]', 'CHANGES_REQUESTED', { commit: OLD }) })).toContain('a newer commit')
  })
})

describe('dismissedReviewEvent', () => {
  it('reports a dismissed change request, and a failed attempt under its own key', () => {
    const old = review('reviewer[bot]', 'CHANGES_REQUESTED', { commit: OLD, id: 42 })
    expect(dismissedReviewEvent({ dismissal: { replies: [], review: old }, dismissed: true, head: HEAD, pr: 7 })).toEqual({
      key: 'pr-7 review-dismissed 42',
      lines: ["REVIEW_DISMISSED: dismissed reviewer[bot]'s change request on an older commit (1234567): the owner approved, and no review thread is open"],
    })
    expect(dismissedReviewEvent({ dismissal: { replies: [], review: old }, dismissed: false, head: HEAD, pr: 7 }).key).toBe('pr-7 review-dismiss-failed 42')
    expect(dismissedReviewEvent({ dismissal: { replies: [{ body: 'Resolved: x', url: '' }], review: review('reviewer[bot]', 'CHANGES_REQUESTED', { id: 43 }) }, dismissed: true, head: HEAD, pr: 7 }).lines).toEqual([
      "REVIEW_DISMISSED: dismissed reviewer[bot]'s change request on the head (abcdef1): the owner approved, and `Resolved:` replies settled it",
    ])
  })
})

describe('approvedEvent (#298)', () => {
  const approved = { draft: false, green: true, head: HEAD, merge: 'gh pr merge 7 --auto', pr: 7, ready: 'gh pr ready 7' }

  it('asks to enable auto-merge once CI is green', () => {
    expect(approvedEvent(approved)).toEqual({ key: `pr-7 ready ${HEAD}`, lines: ['READY_TO_MERGE: approved and CI is green at abcdef1, but auto-merge is off. Enable it: gh pr merge 7 --auto'] })
    expect(approvedEvent({ ...approved, green: false })).toBeNull()
  })

  it('asks to mark a draft ready instead, once per head, green or not', () => {
    const draftEvent = { key: `pr-7 approved-draft ${HEAD}`, lines: ['APPROVED_DRAFT: approved by the owner but still a draft: mark it ready (gh pr ready 7), wait for the bot review, then queue'] }
    expect(approvedEvent({ ...approved, draft: true })).toEqual(draftEvent)
    expect(approvedEvent({ ...approved, draft: true, green: false })).toEqual(draftEvent)
  })
})
