import { describe, expect, it } from 'bun:test'
import { clearsQuestion, isBotLogin, questionClearedEvent, questionUncheckedEvent } from './watch-question-events'

const HEAD = 'abcdef1234567890'
const OLD = '1234567890abcdef'

describe('clearsQuestion (#371)', () => {
  const approved = { approvedCommit: HEAD, enabled: true, labelled: true, state: 'OPEN' }

  it('takes the label off a PR the owner approved, on any commit: the approval is permanent', () => {
    expect(clearsQuestion(approved)).toBe(true)
    expect(clearsQuestion({ ...approved, approvedCommit: OLD })).toBe(true)
  })

  it('takes it off a merged or closed PR, approved or not', () => {
    expect(clearsQuestion({ ...approved, approvedCommit: '', state: 'MERGED' })).toBe(true)
    expect(clearsQuestion({ ...approved, approvedCommit: '', state: 'CLOSED' })).toBe(true)
  })

  it('leaves an open PR the owner has not approved, one without the label, and every PR while it is off', () => {
    expect(clearsQuestion({ ...approved, approvedCommit: '' })).toBe(false)
    expect(clearsQuestion({ ...approved, labelled: false })).toBe(false)
    expect(clearsQuestion({ ...approved, enabled: false })).toBe(false)
    expect(clearsQuestion({ ...approved, enabled: false, state: 'MERGED' })).toBe(false)
  })
})

describe('questionClearedEvent (#371)', () => {
  it('says why the label came off, once per head', () => {
    expect(questionClearedEvent({ approved: OLD, head: HEAD, pr: 7, removed: true, state: 'OPEN' })).toEqual({
      key: `pr-7 question-cleared ${HEAD}`,
      lines: ['QUESTION_CLEARED: the owner approved it (at 1234567; the approval is permanent), so the watcher took the `question` label off (CLEAR_QUESTION_LABEL). Nothing to do.'],
    })
    expect(questionClearedEvent({ approved: '', head: HEAD, pr: 7, removed: true, state: 'MERGED' }).lines[0]).toStartWith('QUESTION_CLEARED: the PR is merged,')
    expect(questionClearedEvent({ approved: '', head: HEAD, pr: 7, removed: true, state: 'CLOSED' }).lines[0]).toStartWith('QUESTION_CLEARED: the PR is closed,')
  })

  it('reports a failure under its own key', () => {
    const failed = questionClearedEvent({ approved: HEAD, head: HEAD, pr: 7, removed: false, state: 'OPEN' })
    expect(failed.key).toBe(`pr-7 question-clear-failed ${HEAD}`)
    expect(failed.lines[0]).toStartWith('QUESTION_CLEAR_FAILED:')
  })
})

describe('isBotLogin (#371)', () => {
  it("counts only a bot's token, never a person's or an unknown one", () => {
    expect(isBotLogin('flixbox-ai-agent[bot]')).toBe(true)
    expect(isBotLogin('Owner')).toBe(false)
    expect(isBotLogin('')).toBe(false)
  })
})

describe('questionUncheckedEvent (#371)', () => {
  it('says the label stays where the GH token is no bot\'s, or that is unknown, once per head', () => {
    const person = questionUncheckedEvent({ head: HEAD, person: true, pr: 7 })
    expect(person.key).toBe(`pr-7 question-unchecked ${HEAD}`)
    expect(person.lines[0]).toContain("the GH token isn't a bot's")
    expect(questionUncheckedEvent({ head: HEAD, person: false, pr: 7 }).lines[0]).toContain("couldn't ask GitHub")
  })
})
