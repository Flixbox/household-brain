import { describe, expect, it } from 'vitest'
import { firebaseOptionsFrom, usesEmulators } from './env'

const complete = {
  VITE_FIREBASE_API_KEY: 'key',
  VITE_FIREBASE_APP_ID: '1:1:web:1',
  VITE_FIREBASE_AUTH_DOMAIN: 'example.web.app',
  VITE_FIREBASE_MESSAGING_SENDER_ID: '1',
  VITE_FIREBASE_PROJECT_ID: 'example',
}

describe('firebaseOptionsFrom', () => {
  it('maps the env variables to Firebase options', () => {
    expect(firebaseOptionsFrom(complete)).toEqual({
      apiKey: 'key',
      appId: '1:1:web:1',
      authDomain: 'example.web.app',
      messagingSenderId: '1',
      projectId: 'example',
    })
  })

  it('names every missing variable', () => {
    const { VITE_FIREBASE_APP_ID: _omitted, ...withoutAppId } = complete
    expect(() => firebaseOptionsFrom({ ...withoutAppId, VITE_FIREBASE_API_KEY: '' }))
      .toThrow('Missing Firebase config: VITE_FIREBASE_API_KEY, VITE_FIREBASE_APP_ID')
  })
})

describe('usesEmulators', () => {
  it('is only true for the literal string "true"', () => {
    expect(usesEmulators({ VITE_USE_EMULATORS: 'true' })).toBe(true)
    expect(usesEmulators({ VITE_USE_EMULATORS: '1' })).toBe(false)
    expect(usesEmulators({})).toBe(false)
  })
})
