import { describe, expect, it } from 'bun:test'
import { clearsQuestion } from './watch-question-events'

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
