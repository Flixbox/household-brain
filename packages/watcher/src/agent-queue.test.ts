import { describe, expect, it } from 'bun:test'
import { type PrFacts, blockersOf, factsFrom } from './agent-queue'

const OWNER = 'owner-login'
const T0 = '2026-11-01T09:00:00Z'
const T1 = '2026-11-01T10:00:00Z'
const T2 = '2026-11-01T11:00:00Z'

const READY: PrFacts = {
  asked: [],
  autoMerge: false,
  checks: [{ name: 'checks', result: 'SUCCESS', workflow: true }, { name: 'CodeRabbit', result: 'SUCCESS', workflow: false }],
  draft: false,
  labels: [],
  openThreads: 0,
  queued: false,
  reviews: [{ at: T1, login: OWNER, state: 'APPROVED' }],
  state: 'OPEN',
  truncated: false,
}

const blockers = (change: Partial<PrFacts>) => blockersOf({ ...READY, ...change }, OWNER)

describe('blockersOf (#354)', () => {
  it('queues an open PR the owner approved, with CI green and no thread open', () => {
    expect(blockersOf(READY, OWNER)).toEqual([])
  })

  it('queues a PR labelled subagent-cleared without the owner, but not one cleared by nobody', () => {
    expect(blockers({ labels: ['subagent-cleared'], reviews: [] })).toEqual([])
    expect(blockers({ reviews: [{ at: T1, login: 'someone-else', state: 'APPROVED' }] })).toEqual([
      "Not cleared: no approval of owner-login's and no subagent-cleared label.",
    ])
  })

  it('keeps the approval once the owner gave it, and counts only their latest stance', () => {
    expect(blockers({ reviews: [{ at: T1, login: OWNER, state: 'APPROVED' }, { at: T1, login: OWNER, state: 'COMMENTED' }] })).toEqual([])
    expect(blockers({ reviews: [{ at: T1, login: OWNER, state: 'APPROVED' }, { at: T1, login: OWNER, state: 'CHANGES_REQUESTED' }] })).toEqual([
      "Not cleared: no approval of owner-login's and no subagent-cleared label.",
      'owner-login requests changes.',
    ])
    expect(blockers({ reviews: [{ at: T0, login: OWNER, state: 'APPROVED' }, { at: T1, login: OWNER, state: 'DISMISSED' }] })).toEqual([
      "Not cleared: no approval of owner-login's and no subagent-cleared label.",
    ])
  })

  it('waits for CI on the head: reported by a workflow, finished, and passed', () => {
    expect(blockers({ checks: [{ name: 'CodeRabbit', result: 'SUCCESS', workflow: false }] })).toEqual(["CI hasn't reported on the head yet."])
    expect(blockers({ checks: [...READY.checks, { name: 'e2e', result: 'PENDING', workflow: true }] })).toEqual(['CI still runs: e2e.'])
    expect(blockers({ checks: [...READY.checks, { name: 'e2e', result: 'FAILURE', workflow: true }] })).toEqual(['CI failed: e2e.'])
    expect(blockers({ checks: [...READY.checks, { name: 'e2e', result: 'SKIPPED', workflow: true }] })).toEqual([])
    expect(blockers({ checks: [{ name: 'checks', result: 'SKIPPED', workflow: true }] })).toEqual(["CI hasn't reported on the head yet."])
  })

  it('waits for open review threads, change requests and an asked-for bot review', () => {
    expect(blockers({ openThreads: 2 })).toEqual(['2 review threads are open.'])
    expect(blockers({ reviews: [...READY.reviews, { at: T1, login: 'coderabbitai', state: 'CHANGES_REQUESTED' }] })).toEqual(['coderabbitai requests changes.'])
    expect(blockers({ reviews: [...READY.reviews, { at: T1, login: 'coderabbitai', state: 'CHANGES_REQUESTED' }, { at: T1, login: 'coderabbitai', state: 'DISMISSED' }] })).toEqual([])
    expect(blockers({ labels: ['bot-review'] })).toEqual(["A review bot's review was asked for (bot-review) and hasn't started."])
  })

  it('waits for a bot asked with a review comment until it has reviewed (the label is gone by then)', () => {
    const asked = [{ at: T1, bot: 'coderabbitai' }]
    const waiting = ['coderabbitai was asked to review (@coderabbitai review) and hasn\'t yet.']
    expect(blockers({ asked })).toEqual(waiting)
    expect(blockers({ asked, reviews: [...READY.reviews, { at: T2, login: 'coderabbitai', state: 'COMMENTED' }] })).toEqual([])
    expect(blockers({ asked, reviews: [...READY.reviews, { at: T0, login: 'coderabbitai', state: 'COMMENTED' }] })).toEqual(waiting)
  })

  it('refuses a PR whose answer GitHub cut off, since a check, review or thread may be missing', () => {
    expect(blockers({ truncated: true })).toEqual(["GitHub's answer was cut off (over a hundred checks, labels, reviews or threads): check it by hand."])
  })

  it('refuses a draft and a PR that is no longer open', () => {
    expect(blockers({ draft: true })).toEqual(['It is a draft.'])
    expect(blockers({ state: 'MERGED' })).toEqual(['It is merged, not open.'])
  })
})

describe('factsFrom (#354)', () => {
  it("reads GitHub's answer: checks of workflows and other apps, labels, reviews, open threads and a list cut off", () => {
    const facts = factsFrom({
      autoMergeRequest: null,
      comments: { nodes: [
        { body: 'Looks fine.', createdAt: T0 },
        { body: '@coderabbitai review', createdAt: T0 },
        { body: ' @CodeRabbitAI[bot] review\n', createdAt: T1 },
        { body: '@coderabbitai resolve', createdAt: T2 },
      ] },
      commits: { nodes: [{ commit: { statusCheckRollup: { contexts: { nodes: [
        { checkSuite: { workflowRun: { databaseId: 7 } }, conclusion: null, name: 'checks', status: 'IN_PROGRESS' },
        { checkSuite: { workflowRun: null }, conclusion: 'SUCCESS', name: 'CodeRabbit', status: 'COMPLETED' },
        { context: 'deploy/preview', state: 'FAILURE' },
      ], pageInfo: { hasNextPage: false } } } } }] },
      isDraft: false,
      isInMergeQueue: true,
      labels: { nodes: [{ name: 'subagent-cleared' }] },
      reviewThreads: { nodes: [{ isResolved: true }, { isResolved: false }], pageInfo: { hasNextPage: false } },
      reviews: { nodes: [{ author: { login: OWNER }, state: 'APPROVED', submittedAt: T1 }], pageInfo: { hasPreviousPage: true } },
      state: 'OPEN',
    })
    expect(facts).toEqual({
      asked: [{ at: T1, bot: 'coderabbitai' }],
      autoMerge: false,
      checks: [
        { name: 'checks', result: 'PENDING', workflow: true },
        { name: 'CodeRabbit', result: 'SUCCESS', workflow: false },
        { name: 'deploy/preview', result: 'FAILURE', workflow: false },
      ],
      draft: false,
      labels: ['subagent-cleared'],
      openThreads: 1,
      queued: true,
      reviews: [{ at: T1, login: OWNER, state: 'APPROVED' }],
      state: 'OPEN',
      truncated: true,
    })
  })
})
