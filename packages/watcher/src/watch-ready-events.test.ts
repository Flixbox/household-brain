import { describe, expect, it } from 'bun:test'
import { draftNote, draftReadiedEvent, marksReady, ownerApprovalCommit, wasDraftAt } from './watch-ready-events'
import { awaitsBotReview } from './watch-review-events'

const HEAD = 'abcdef1234567890'
const OLD = '1234567890abcdef'
const review = (login: string, state: string, commit = HEAD) => ({ commit, login, state })

describe('ownerApprovalCommit (#301, #317)', () => {
  it("names the commit of the owner's latest counting review when it approves, on any commit", () => {
    expect(ownerApprovalCommit([review('Owner', 'APPROVED')], 'owner')).toBe(HEAD)
    expect(ownerApprovalCommit([review('owner', 'APPROVED'), review('owner', 'COMMENTED')], 'owner')).toBe(HEAD)
    expect(ownerApprovalCommit([review('owner', 'APPROVED', OLD)], 'owner')).toBe(OLD)
    expect(ownerApprovalCommit([review('owner', 'APPROVED', OLD), review('owner', 'COMMENTED')], 'owner')).toBe(OLD)
    expect(ownerApprovalCommit([review('owner', 'CHANGES_REQUESTED', OLD), review('owner', 'APPROVED')], 'owner')).toBe(HEAD)
  })

  it('is empty when the latest counting review takes the approval back', () => {
    expect(ownerApprovalCommit([review('owner', 'APPROVED'), review('owner', 'DISMISSED')], 'owner')).toBe('')
    expect(ownerApprovalCommit([review('owner', 'APPROVED', OLD), review('owner', 'CHANGES_REQUESTED')], 'owner')).toBe('')
    expect(ownerApprovalCommit([review('owner', 'COMMENTED')], 'owner')).toBe('')
  })

  it("never counts anyone else's approval, nor a bot's", () => {
    expect(ownerApprovalCommit([review('someone', 'APPROVED'), review('coderabbitai[bot]', 'APPROVED')], 'owner')).toBe('')
    expect(ownerApprovalCommit([review('coderabbitai[bot]', 'APPROVED')], 'coderabbitai[bot]')).toBe('')
  })
})

describe('marksReady (#301, #317)', () => {
  const ready = { approvedCommit: HEAD, draft: true, enabled: true }

  it('marks a draft the owner approved, on any commit, ready when READY_APPROVED_DRAFTS is on', () => {
    expect(marksReady(ready)).toBe(true)
    expect(marksReady({ ...ready, approvedCommit: OLD })).toBe(true)
    expect(marksReady({ ...ready, approvedCommit: '' })).toBe(false)
    expect(marksReady({ ...ready, draft: false })).toBe(false)
  })

  it('leaves it to the agent (APPROVED_DRAFT) when it is off', () => {
    expect(marksReady({ ...ready, enabled: false })).toBe(false)
    expect(draftNote(false)).toContain('see APPROVED_DRAFT')
    expect(draftNote(true)).toContain('DRAFT_READIED')
  })
})

describe('draftReadiedEvent (#301)', () => {
  it('reports the draft marked ready once per head, and a failure under its own key', () => {
    expect(draftReadiedEvent({ approved: HEAD, head: HEAD, pr: 7, readied: true })).toEqual({
      key: `pr-7 draft-readied ${HEAD}`,
      lines: ["DRAFT_READIED: the owner approved the draft's head (abcdef1), so the watcher marked it ready (READY_APPROVED_DRAFTS): wait for the bot review of the head, settle its threads, then queue"],
    })
    expect(draftReadiedEvent({ approved: HEAD, head: HEAD, pr: 7, readied: false }).key).toBe(`pr-7 draft-ready-failed ${HEAD}`)
  })

  it('names the older commit the owner approved, keyed by the head (#317)', () => {
    expect(draftReadiedEvent({ approved: OLD, head: HEAD, pr: 7, readied: true })).toEqual({
      key: `pr-7 draft-readied ${HEAD}`,
      lines: ['DRAFT_READIED: the owner approved the draft at 1234567, before its head abcdef1, so the watcher marked it ready (READY_APPROVED_DRAFTS): wait for the bot review of the head, settle its threads, then queue'],
    })
  })

  it('counts as approved as a draft, like APPROVED_DRAFT, for the wait on the bot review (#299)', () => {
    const reported = [`pr-7 draft-readied ${HEAD}`]
    expect(wasDraftAt(reported, 7, HEAD)).toBe(true)
    expect(wasDraftAt([`pr-7 approved-draft ${HEAD}`], 7, HEAD)).toBe(true)
    expect(wasDraftAt(reported, 7, OLD)).toBe(false)
    expect(wasDraftAt([`pr-7 draft-ready-failed ${HEAD}`], 7, HEAD)).toBe(false)
    expect(awaitsBotReview({ bots: ['coderabbitai'], pr: 7, reported, reviewed: false })).toBe(true)
  })

  it('still waits for the bot review of the head when the approval was on an older commit (#317)', () => {
    const reported = [draftReadiedEvent({ approved: OLD, head: HEAD, pr: 7, readied: true }).key]
    expect(awaitsBotReview({ bots: ['coderabbitai'], pr: 7, reported, reviewed: false })).toBe(true)
    expect(awaitsBotReview({ bots: ['coderabbitai'], pr: 7, reported, reviewed: true })).toBe(false)
  })
})
