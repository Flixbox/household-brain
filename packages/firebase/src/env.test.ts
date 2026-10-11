import { describe, expect, it } from 'bun:test'
import { firebaseOptionsFrom } from './env'

const complete = {
  BUN_PUBLIC_FIREBASE_API_KEY: 'key',
  BUN_PUBLIC_FIREBASE_APP_ID: '1:1:web:1',
  BUN_PUBLIC_FIREBASE_AUTH_DOMAIN: 'household-brain.test',
  BUN_PUBLIC_FIREBASE_MESSAGING_SENDER_ID: '1',
  BUN_PUBLIC_FIREBASE_PROJECT_ID: 'example',
}

describe('firebaseOptionsFrom', () => {
  it('maps the env variables to Firebase options', () => {
    expect(firebaseOptionsFrom(complete)).toEqual({
      apiKey: 'key',
      appId: '1:1:web:1',
      authDomain: 'household-brain.test',
      messagingSenderId: '1',
      projectId: 'example',
    })
  })

  it('names every missing variable', () => {
    const { BUN_PUBLIC_FIREBASE_APP_ID: _omitted, ...withoutAppId } = complete
    expect(() => firebaseOptionsFrom({ ...withoutAppId, BUN_PUBLIC_FIREBASE_API_KEY: '' }))
      .toThrow('Missing Firebase config: BUN_PUBLIC_FIREBASE_API_KEY, BUN_PUBLIC_FIREBASE_APP_ID')
  })
})
