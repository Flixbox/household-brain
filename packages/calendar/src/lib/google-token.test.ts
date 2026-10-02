import { cleanTestStorage, getTestStorage, useTestStorageEngine } from '@nanostores/persistent'
import { Temporal } from 'temporal-polyfill'
import { afterEach, describe, expect, it } from 'vitest'
import { $calendarToken, MEMBER_SCOPES, OWNER_SCOPES, acceptToken, forgetCalendarToken, hasCalendarToken } from './google-token'

// oxlint-disable-next-line react-hooks/rules-of-hooks -- nanostores' switch to fake storage, not a React hook
useTestStorageEngine()
const now = () => Temporal.Now.instant().epochMilliseconds
const ME = 'me@household-brain.test'

const response = (scope: string, extra = {}) => ({ access_token: 'token-1', expires_in: 3600, scope, ...extra })

describe('acceptToken', () => {
  it('keeps the token and every granted scope', () => {
    const token = acceptToken(response(OWNER_SCOPES.join(' ')), MEMBER_SCOPES, ME)
    expect(token.value).toBe('token-1')
    expect(token.scopes).toEqual([...OWNER_SCOPES])
    expect(token.usableUntil).toBeGreaterThan(now())
  })

  it('rejects a grant that is missing a scope (Google lets people untick permissions)', () => {
    expect(() => acceptToken(response(MEMBER_SCOPES[0]), MEMBER_SCOPES, ME)).toThrow(/missing: .*calendar\.calendarlist/u)
  })

  it('rejects an error response', () => {
    expect(() => acceptToken(response('', { error: 'access_denied' }), MEMBER_SCOPES, ME)).toThrow('access_denied')
  })
})

describe('the stored token', () => {
  afterEach(() => {
    forgetCalendarToken()
    cleanTestStorage()
  })

  it('is kept in storage, so a reload still has it', () => {
    $calendarToken.set(acceptToken(response(MEMBER_SCOPES.join(' ')), MEMBER_SCOPES, ME))
    expect(JSON.parse(getTestStorage()['hb:calendar-token'] ?? '{}')).toMatchObject({ value: 'token-1' })
    expect(hasCalendarToken(MEMBER_SCOPES, ME)).toBe(true)
  })

  it('does not count once it has expired, or when it lacks a scope', () => {
    $calendarToken.set({ account: ME, scopes: [...MEMBER_SCOPES], usableUntil: now() - 1, value: 'old' })
    expect(hasCalendarToken(MEMBER_SCOPES, ME)).toBe(false)
    $calendarToken.set({ account: ME, scopes: [...MEMBER_SCOPES], usableUntil: now() + 60_000, value: 'narrow' })
    expect(hasCalendarToken(OWNER_SCOPES, ME)).toBe(false)
  })

  it('never serves another account, or no account', () => {
    $calendarToken.set({ account: ME, scopes: [...MEMBER_SCOPES], usableUntil: now() + 60_000, value: 'mine' })
    expect(hasCalendarToken(MEMBER_SCOPES, 'someone-else@household-brain.test')).toBe(false)
    expect(hasCalendarToken(MEMBER_SCOPES, null)).toBe(false)
  })

  it('is cleared from storage when forgotten', () => {
    $calendarToken.set(acceptToken(response(MEMBER_SCOPES.join(' ')), MEMBER_SCOPES, ME))
    forgetCalendarToken()
    expect(getTestStorage()['hb:calendar-token']).toBe('null')
    expect(hasCalendarToken(MEMBER_SCOPES, ME)).toBe(false)
  })
})
