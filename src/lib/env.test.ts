import { describe, expect, it } from 'vitest'
import { firebaseOptionsFrom, usesEmulators } from './env'

const complete = {
  VITE_FIREBASE_API_KEY: 'key',
  VITE_FIREBASE_AUTH_DOMAIN: 'example.web.app',
  VITE_FIREBASE_PROJECT_ID: 'example',
  VITE_FIREBASE_MESSAGING_SENDER_ID: '1',
  VITE_FIREBASE_APP_ID: '1:1:web:1',
}

describe('firebaseOptionsFrom', () => {
  it('maps the env variables to Firebase options', () => {
    expect(firebaseOptionsFrom(complete)).toEqual({
      apiKey: 'key',
      authDomain: 'example.web.app',
      projectId: 'example',
      messagingSenderId: '1',
      appId: '1:1:web:1',
    })
  })

  it('names every missing variable', () => {
    expect(() => firebaseOptionsFrom({ ...complete, VITE_FIREBASE_API_KEY: '', VITE_FIREBASE_APP_ID: undefined }))
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
