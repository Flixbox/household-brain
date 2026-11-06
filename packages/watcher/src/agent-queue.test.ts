import { describe, expect, it } from 'bun:test'
import { type PrFacts, blockersOf, factsFrom } from './agent-queue'

const OWNER = 'owner-login'

const READY: PrFacts = {
  autoMerge: false,
  checks: [{ name: 'checks', result: 'SUCCESS', workflow: true }, { name: 'CodeRabbit', result: 'SUCCESS', workflow: false }],
  draft: false,
  labels: [],
  openThreads: 0,
  queued: false,
  reviews: [{ login: OWNER, state: 'APPROVED' }],
  state: 'OPEN',
}

const blockers = (change: Partial<PrFacts>) => blockersOf({ ...READY, ...change }, OWNER)

describe('blockersOf (#354)', () => {
  it('queues an open PR the owner approved, with CI green and no thread open', () => {
    expect(blockersOf(READY, OWNER)).toEqual([])
  })

  it('queues a PR labelled subagent-cleared without the owner, but not one cleared by nobody', () => {
    expect(blockers({ labels: ['subagent-cleared'], reviews: [] })).toEqual([])
    expect(blockers({ reviews: [{ login: 'someone-else', state: 'APPROVED' }] })).toEqual([
      "Not cleared: no approval of owner-login's and no subagent-cleared label.",
    ])
  })

  it('keeps the approval once the owner gave it, and counts only their latest stance', () => {
    expect(blockers({ reviews: [{ login: OWNER, state: 'APPROVED' }, { login: OWNER, state: 'COMMENTED' }] })).toEqual([])
    expect(blockers({ reviews: [{ login: OWNER, state: 'APPROVED' }, { login: OWNER, state: 'CHANGES_REQUESTED' }] })).toEqual([
      "Not cleared: no approval of owner-login's and no subagent-cleared label.",
      'owner-login requests changes.',
    ])
  })

  it('waits for CI on the head: reported by a workflow, finished, and passed', () => {
    expect(blockers({ checks: [{ name: 'CodeRabbit', result: 'SUCCESS', workflow: false }] })).toEqual(["CI hasn't reported on the head yet."])
    expect(blockers({ checks: [...READY.checks, { name: 'e2e', result: 'PENDING', workflow: true }] })).toEqual(['CI still runs: e2e.'])
    expect(blockers({ checks: [...READY.checks, { name: 'e2e', result: 'FAILURE', workflow: true }] })).toEqual(['CI failed: e2e.'])
    expect(blockers({ checks: [...READY.checks, { name: 'e2e', result: 'SKIPPED', workflow: true }] })).toEqual([])
  })

  it('waits for open review threads, change requests and an asked-for bot review', () => {
    expect(blockers({ openThreads: 2 })).toEqual(['2 review threads are open.'])
    expect(blockers({ reviews: [...READY.reviews, { login: 'coderabbitai', state: 'CHANGES_REQUESTED' }] })).toEqual(['coderabbitai requests changes.'])
    expect(blockers({ reviews: [...READY.reviews, { login: 'coderabbitai', state: 'CHANGES_REQUESTED' }, { login: 'coderabbitai', state: 'DISMISSED' }] })).toEqual([])
    expect(blockers({ labels: ['bot-review'] })).toEqual(["A review bot's review was asked for (bot-review) and hasn't started."])
  })

  it('refuses a draft and a PR that is no longer open', () => {
    expect(blockers({ draft: true })).toEqual(['It is a draft.'])
    expect(blockers({ state: 'MERGED' })).toEqual(['It is merged, not open.'])
  })
})

describe('factsFrom (#354)', () => {
  it("reads GitHub's answer: checks of workflows and other apps, labels, reviews and open threads", () => {
    const facts = factsFrom({
      autoMergeRequest: null,
      commits: { nodes: [{ commit: { statusCheckRollup: { contexts: { nodes: [
        { __typename: 'CheckRun', checkSuite: { workflowRun: { databaseId: 7 } }, conclusion: null, name: 'checks', status: 'IN_PROGRESS' },
        { __typename: 'CheckRun', checkSuite: { workflowRun: null }, conclusion: 'SUCCESS', name: 'CodeRabbit', status: 'COMPLETED' },
        { __typename: 'StatusContext', context: 'deploy/preview', state: 'FAILURE' },
      ] } } } }] },
      isDraft: false,
      isInMergeQueue: true,
      labels: { nodes: [{ name: 'subagent-cleared' }] },
      reviewThreads: { nodes: [{ isResolved: true }, { isResolved: false }] },
      reviews: { nodes: [{ author: { login: OWNER }, state: 'APPROVED' }] },
      state: 'OPEN',
    })
    expect(facts).toEqual({
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
      reviews: [{ login: OWNER, state: 'APPROVED' }],
      state: 'OPEN',
    })
  })
})
