import { describe, expect, it } from 'vitest'
import { MEMBER_SCOPES, OWNER_SCOPES, acceptToken } from './google-token'

const response = (scope: string, extra = {}) => ({ access_token: 'token-1', expires_in: 3600, scope, ...extra })

describe('acceptToken', () => {
  it('keeps the token and every granted scope', () => {
    const token = acceptToken(response(OWNER_SCOPES.join(' ')), MEMBER_SCOPES)
    expect(token.value).toBe('token-1')
    expect([...token.scopes]).toEqual([...OWNER_SCOPES])
    expect(token.usableUntil).toBeGreaterThan(performance.now())
  })

  it('rejects a grant that is missing a scope (Google lets people untick permissions)', () => {
    expect(() => acceptToken(response(MEMBER_SCOPES[0]), MEMBER_SCOPES)).toThrow(/missing: .*calendar\.calendarlist/u)
  })

  it('rejects an error response', () => {
    expect(() => acceptToken(response('', { error: 'access_denied' }), MEMBER_SCOPES)).toThrow('access_denied')
  })
})
