import { describe, expect, it } from 'vitest'
import { signInErrorMessage } from './sign-in-errors'

const authError = (code: string) => Object.assign(new Error(`Firebase: Error (${code}).`), { code })

describe('signInErrorMessage', () => {
  it('stays silent when the person closed the popup', () => {
    expect(signInErrorMessage(authError('auth/popup-closed-by-user'))).toBeNull()
    expect(signInErrorMessage(authError('auth/cancelled-popup-request'))).toBeNull()
  })

  it('explains disabled sign-up instead of showing the raw Firebase code', () => {
    expect(signInErrorMessage(authError('auth/admin-restricted-operation'))).toContain('Enable create (sign-up)')
  })

  it('explains a blocked popup', () => {
    expect(signInErrorMessage(authError('auth/popup-blocked'))).toContain('Allow pop-ups')
  })

  it('falls back to the error message', () => {
    expect(signInErrorMessage(authError('auth/network-request-failed'))).toBe('Firebase: Error (auth/network-request-failed).')
    expect(signInErrorMessage('plain failure')).toBe('plain failure')
  })
})
