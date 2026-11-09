import { describe, expect, it } from 'bun:test'
import { type PrFacts, factsFrom } from './agent-queue-facts'
import { blockersOf } from './agent-queue'

const OWNER = 'owner-login'
const T0 = '2026-11-01T09:00:00Z'
const T1 = '2026-11-01T10:00:00Z'
const T2 = '2026-11-01T11:00:00Z'
const T3 = '2026-11-01T12:00:00Z'
const SELF = 'agent-bot[bot]'
const NOT_CLEARED = "Not cleared: no approval of owner-login's, and no subagent-cleared label put on by owner-login or agent-bot[bot]."

/** The cleared label put on at `at` by `login` (GraphQL names a bot without `[bot]`, and its kind `Bot`). */
const labelled = (login: string, when: string, kind = 'Bot') => ({ actor: { kind, login }, createdAt: when, kind: 'LabeledEvent', label: { name: 'subagent-cleared' } })

const READY: PrFacts = {
  asked: [],
  autoMerge: false,
  checks: [{ name: 'checks', result: 'SUCCESS', workflow: true }, { name: 'CodeRabbit', result: 'SUCCESS', workflow: false }],
  draft: false,
  head: 'c0ffee',
  id: 'PR_one',
  labelEvents: [],
  labels: [],
  lastPush: T0,
  mergeQueue: false,
  mergeState: 'CLEAN',
  openThreads: 0,
  queued: false,
  reviews: [{ at: T1, login: OWNER, state: 'APPROVED' }],
  self: SELF,
  settledAt: T0,
  state: 'OPEN',
  truncated: false,
}

const blockers = (change: Partial<PrFacts>) => blockersOf({ ...READY, ...change }, OWNER)

describe('blockersOf (#354)', () => {
  it('queues an open PR the owner approved, with CI green and no thread open', () => {
    expect(blockersOf(READY, OWNER)).toEqual([])
  })

  it('queues a PR labelled subagent-cleared without the owner, but not one cleared by nobody', () => {
    const cleared = { labelEvents: [labelled('agent-bot', T1)], labels: ['subagent-cleared'], reviews: [] }
    expect(blockers(cleared)).toEqual([])
    expect(blockers({ ...cleared, labelEvents: [labelled(OWNER, T1, 'User')] })).toEqual([])
    expect(blockers({ reviews: [{ at: T1, login: 'someone-else', state: 'APPROVED' }] })).toEqual([NOT_CLEARED])
  })

  it('counts the label only when the owner or the bot asking put it on (#327, #331)', () => {
    expect(blockers({ labelEvents: [labelled('someone-else', T1, 'User')], labels: ['subagent-cleared'], reviews: [] })).toEqual([NOT_CLEARED])
    expect(blockers({ labelEvents: [labelled('other-app', T1)], labels: ['subagent-cleared'], reviews: [] })).toEqual([NOT_CLEARED])
  })

  it('counts the label only when it went on after the last push', () => {
    const early = { labelEvents: [labelled('agent-bot', T1)], labels: ['subagent-cleared'], lastPush: T2 }
    expect(blockers({ ...early, reviews: [] })).toEqual(['Cleared (subagent-cleared) before the last push: clear it again.'])
    expect(blockers(early)).toEqual([])
    expect(blockers({ ...early, lastPush: '', reviews: [] })).toEqual(["Can't tell when the head was last pushed (no CI run for its branch on it), so subagent-cleared doesn't clear it."])
  })

  it('keeps the approval once the owner gave it, and counts only their latest stance', () => {
    expect(blockers({ reviews: [{ at: T1, login: OWNER, state: 'APPROVED' }, { at: T1, login: OWNER, state: 'COMMENTED' }] })).toEqual([])
    expect(blockers({ reviews: [{ at: T1, login: OWNER, state: 'APPROVED' }, { at: T1, login: OWNER, state: 'CHANGES_REQUESTED' }] })).toEqual([
      NOT_CLEARED,
      'owner-login requests changes.',
    ])
    expect(blockers({ reviews: [{ at: T0, login: OWNER, state: 'APPROVED' }, { at: T1, login: OWNER, state: 'DISMISSED' }] })).toEqual([NOT_CLEARED])
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
  it("reads GitHub's answer: checks of workflows and other apps, labels and their events, the last push, reviews, review asks, open threads and a list cut off", () => {
    const facts = factsFrom({
      autoMergeRequest: null,
      comments: { nodes: [
        { body: 'Looks fine.', createdAt: T0 },
        { body: '@coderabbitai review', createdAt: T0 },
        { body: ' @CodeRabbitAI[bot] review\n', createdAt: T1 },
        { body: '@coderabbitai resolve', createdAt: T2 },
        { body: '@other-bot full review', createdAt: T2 },
      ] },
      commits: { nodes: [{ commit: { committedDate: T0, statusCheckRollup: { contexts: { nodes: [
        { checkSuite: { branch: { name: 'feature' }, createdAt: T2, workflowRun: { event: 'pull_request' } }, conclusion: null, name: 'checks', status: 'IN_PROGRESS' },
        { checkSuite: { branch: { name: 'other' }, createdAt: T3, workflowRun: { event: 'push' } }, conclusion: 'SUCCESS', name: 'elsewhere', status: 'COMPLETED' },
        { checkSuite: { branch: { name: 'feature' }, createdAt: T3, workflowRun: { event: 'workflow_dispatch' } }, conclusion: 'SUCCESS', name: 'by hand', status: 'COMPLETED' },
        { checkSuite: { createdAt: T0, workflowRun: null }, conclusion: 'SUCCESS', name: 'CodeRabbit', status: 'COMPLETED' },
        { context: 'deploy/preview', state: 'FAILURE' },
      ], pageInfo: { hasNextPage: false } } } } }] },
      headRefName: 'feature',
      headRefOid: 'c0ffee',
      id: 'PR_one',
      isDraft: false,
      isInMergeQueue: true,
      isMergeQueueEnabled: true,
      labels: { nodes: [{ name: 'subagent-cleared' }] },
      reviewThreads: { nodes: [{ isResolved: true }, { isResolved: false }], pageInfo: { hasNextPage: false } },
      reviews: { nodes: [{ author: { login: OWNER }, state: 'APPROVED', submittedAt: T1 }], pageInfo: { hasPreviousPage: true } },
      state: 'OPEN',
      timelineItems: { nodes: [labelled('agent-bot', T1), { createdAt: T1, kind: 'HeadRefForcePushedEvent' }], pageInfo: { hasPreviousPage: false } },
    }, SELF)
    expect(facts).toEqual({
      asked: [{ at: T1, bot: 'coderabbitai' }, { at: T2, bot: 'other-bot' }],
      autoMerge: false,
      checks: [
        { name: 'checks', result: 'PENDING', workflow: true },
        { name: 'elsewhere', result: 'SUCCESS', workflow: true },
        { name: 'by hand', result: 'SUCCESS', workflow: true },
        { name: 'CodeRabbit', result: 'SUCCESS', workflow: false },
        { name: 'deploy/preview', result: 'FAILURE', workflow: false },
      ],
      draft: false,
      head: 'c0ffee',
      id: 'PR_one',
      labelEvents: [labelled('agent-bot', T1)],
      labels: ['subagent-cleared'],
      lastPush: T2,
      mergeQueue: true,
      openThreads: 1,
      queued: true,
      reviews: [{ at: T1, login: OWNER, state: 'APPROVED' }],
      self: SELF,
      state: 'OPEN',
      truncated: true,
    })
  })
})
