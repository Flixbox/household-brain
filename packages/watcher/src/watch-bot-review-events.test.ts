import { describe, expect, it } from 'bun:test'
import { awaitsBotReview, botReviewEvent, botReviewStateOf, notAskingBecause } from './watch-bot-review-events'
import { type PrComment, botNames, resolveCommand } from './watch-review-events'

const SELF = 'agent[bot]'
const comment = (author: string, body: string): PrComment => ({ author, body, createdAt: '2026-10-26T11:00:00Z', url: 'https://github.test/pr/1#c' })
const botReview = (login: string, oid = 'abcdef1') => ({ author: { login }, commit: { oid }, state: 'COMMENTED' })
const suite = (slug: string, ...statuses: string[]) => ({ app: { slug }, checkRuns: { nodes: statuses.map(status => ({ status })) } })
const none = { requested: false, reviewed: [], reviewing: false }

describe('botNames', () => {
  it('reads a comma-separated setting, with or without `[bot]`, in lower case', () => {
    expect(botNames(' CodeRabbitAI[bot], other ,')).toEqual(['coderabbitai', 'other'])
    expect(botNames('')).toEqual([])
  })
})

describe('botReviewStateOf', () => {
  const bots = ['coderabbitai']

  it('lists the named bots that reviewed the PR, on any commit, once each', () => {
    expect(botReviewStateOf({ bots, labels: [], reviews: [botReview('coderabbitai[bot]', 'older'), botReview('coderabbitai'), botReview('someone')], suites: [] }).reviewed).toEqual(['coderabbitai'])
    expect(botReviewStateOf({ bots, labels: [], reviews: [botReview('someone')], suites: [] }).reviewed).toEqual([])
  })

  it('sees the label ask for a review, only with bots named', () => {
    expect(botReviewStateOf({ bots, labels: ['parked', 'bot-review'], reviews: [], suites: [] }).requested).toBe(true)
    expect(botReviewStateOf({ bots: [], labels: ['bot-review'], reviews: [], suites: [] }).requested).toBe(false)
    expect(botReviewStateOf({ bots, labels: ['parked'], reviews: [], suites: [] }).requested).toBe(false)
  })

  it("sees a named bot reviewing while its check run on the head isn't completed", () => {
    expect(botReviewStateOf({ bots, labels: [], reviews: [], suites: [suite('coderabbitai', 'IN_PROGRESS')] }).reviewing).toBe(true)
    expect(botReviewStateOf({ bots, labels: [], reviews: [], suites: [suite('coderabbitai', 'COMPLETED')] }).reviewing).toBe(false)
    expect(botReviewStateOf({ bots, labels: [], reviews: [], suites: [suite('github-actions', 'IN_PROGRESS')] }).reviewing).toBe(false)
    // A suite the app never started a run in (GitHub queues one for every app on a push) isn't a review.
    expect(botReviewStateOf({ bots, labels: [], reviews: [], suites: [suite('coderabbitai')] }).reviewing).toBe(false)
  })
})

describe('awaitsBotReview', () => {
  it('waits for a bot asked for its review until it reviewed the PR, on any commit', () => {
    expect(awaitsBotReview({ asked: ['coderabbitai'], state: none })).toBe(true)
    expect(awaitsBotReview({ asked: ['coderabbitai'], state: { ...none, reviewed: ['coderabbitai'] } })).toBe(false)
  })

  it('waits for a review in progress, asked for or not', () => {
    expect(awaitsBotReview({ asked: [], state: { ...none, reviewing: true } })).toBe(true)
  })

  it('waits while the label still asks for a review the watcher has yet to post', () => {
    expect(awaitsBotReview({ asked: [], state: { ...none, requested: true } })).toBe(true)
  })

  it('never waits for a review nobody asked for (unlike #299)', () => {
    expect(awaitsBotReview({ asked: [], state: none })).toBe(false)
  })
})

describe('notAskingBecause', () => {
  it('asks a bot that never reviewed the PR and was never asked', () => {
    expect(notAskingBecause({ bot: 'coderabbitai', comments: [comment('owner', 'Looks fine')], state: none })).toBeNull()
  })

  it('never asks twice: not after a review, not after a `@<bot> review` comment', () => {
    expect(notAskingBecause({ bot: 'coderabbitai', comments: [], state: { ...none, reviewed: ['coderabbitai'] } })).toBe('it reviewed this PR already')
    expect(notAskingBecause({ bot: 'coderabbitai', comments: [comment(SELF, ' @CodeRabbitAI review ')], state: none })).toBe('it was asked already')
  })

  it('takes `@<bot> resolve` for no ask (#303)', () => {
    expect(notAskingBecause({ bot: 'coderabbitai', comments: [comment(SELF, resolveCommand('coderabbitai'))], state: none })).toBeNull()
  })
})

describe('botReviewEvent', () => {
  it('reports an ask once per PR and bot, with the label it took off', () => {
    expect(botReviewEvent({ bot: 'coderabbitai[bot]', outcome: { asked: true }, pr: 7, unlabelled: true })).toEqual({
      key: 'pr-7 bot-review-asked coderabbitai',
      lines: ['BOT_REVIEW_ASKED: asked coderabbitai for its review (`@coderabbitai review`), never again for this PR; removed the label `bot-review`. READY_TO_MERGE waits for its review'],
    })
  })

  it('reports a failure and a skip under keys of their own', () => {
    expect(botReviewEvent({ bot: 'coderabbitai', outcome: { asked: false }, pr: 7, unlabelled: false }).key).toBe('pr-7 bot-review-failed coderabbitai')
    const skipped = botReviewEvent({ bot: 'coderabbitai', outcome: { skipped: 'it reviewed this PR already' }, pr: 7, unlabelled: false })
    expect(skipped.key).toBe('pr-7 bot-review-skipped coderabbitai')
    expect(skipped.lines[0]).toContain("couldn't remove the label `bot-review` yet")
  })
})
