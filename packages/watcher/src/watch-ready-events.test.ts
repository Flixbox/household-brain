import { describe, expect, it } from 'bun:test'
import { draftNote, draftReadiedEvent, marksReady, ownerApprovedHead, wasDraftAt } from './watch-ready-events'
import { awaitsBotReview } from './watch-review-events'

const HEAD = 'abcdef1234567890'
const OLD = '1234567890abcdef'
const review = (login: string, state: string, commit = HEAD) => ({ commit, login, state })

describe('ownerApprovedHead (#301)', () => {
  it("counts only the owner's latest counting review, approving the head", () => {
    expect(ownerApprovedHead([review('Owner', 'APPROVED')], 'owner', HEAD)).toBe(true)
    expect(ownerApprovedHead([review('owner', 'APPROVED'), review('owner', 'COMMENTED')], 'owner', HEAD)).toBe(true)
    expect(ownerApprovedHead([review('owner', 'APPROVED', OLD)], 'owner', HEAD)).toBe(false)
    expect(ownerApprovedHead([review('owner', 'APPROVED'), review('owner', 'DISMISSED')], 'owner', HEAD)).toBe(false)
    expect(ownerApprovedHead([review('owner', 'CHANGES_REQUESTED', OLD), review('owner', 'APPROVED')], 'owner', HEAD)).toBe(true)
  })

  it("never counts anyone else's approval, nor a bot's", () => {
    expect(ownerApprovedHead([review('someone', 'APPROVED'), review('coderabbitai[bot]', 'APPROVED')], 'owner', HEAD)).toBe(false)
    expect(ownerApprovedHead([review('coderabbitai[bot]', 'APPROVED')], 'coderabbitai[bot]', HEAD)).toBe(false)
  })
})

describe('marksReady (#301)', () => {
  const ready = { draft: true, enabled: true, ownerApprovedHead: true }

  it('marks a draft the owner approved at its head ready when READY_APPROVED_DRAFTS is on', () => {
    expect(marksReady(ready)).toBe(true)
    expect(marksReady({ ...ready, ownerApprovedHead: false })).toBe(false)
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
    expect(draftReadiedEvent({ head: HEAD, pr: 7, readied: true })).toEqual({
      key: `pr-7 draft-readied ${HEAD}`,
      lines: ["DRAFT_READIED: the owner approved the draft's head (abcdef1), so the watcher marked it ready (READY_APPROVED_DRAFTS): wait for the bot review, settle its threads, then queue"],
    })
    expect(draftReadiedEvent({ head: HEAD, pr: 7, readied: false }).key).toBe(`pr-7 draft-ready-failed ${HEAD}`)
  })

  it('counts as approved as a draft, like APPROVED_DRAFT, for the wait on the bot review (#299)', () => {
    const reported = [`pr-7 draft-readied ${HEAD}`]
    expect(wasDraftAt(reported, 7, HEAD)).toBe(true)
    expect(wasDraftAt([`pr-7 approved-draft ${HEAD}`], 7, HEAD)).toBe(true)
    expect(wasDraftAt(reported, 7, OLD)).toBe(false)
    expect(wasDraftAt([`pr-7 draft-ready-failed ${HEAD}`], 7, HEAD)).toBe(false)
    expect(awaitsBotReview({ bots: ['coderabbitai'], pr: 7, reported, reviewed: false })).toBe(true)
  })
})
