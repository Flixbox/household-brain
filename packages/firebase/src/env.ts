import type { Env } from 'bun'
import type { FirebaseOptions } from 'firebase/app'
import { hasText } from '@household-brain/core/lib/read'

const REQUIRED = {
  apiKey: 'BUN_PUBLIC_FIREBASE_API_KEY',
  appId: 'BUN_PUBLIC_FIREBASE_APP_ID',
  authDomain: 'BUN_PUBLIC_FIREBASE_AUTH_DOMAIN',
  messagingSenderId: 'BUN_PUBLIC_FIREBASE_MESSAGING_SENDER_ID',
  projectId: 'BUN_PUBLIC_FIREBASE_PROJECT_ID',
} as const satisfies Record<string, keyof Env>

/** Builds the Firebase options from the build's environment, failing loudly when a value is missing. */
export const firebaseOptionsFrom = (env: Partial<Record<string, string | undefined>>): FirebaseOptions => {
  const missing = Object.values(REQUIRED).filter(key => !hasText(env[key]))
  if (missing.length > 0) {
    throw new Error(`Missing Firebase config: ${missing.join(', ')}`)
  }
  // Every value is there now; `?? ''` only tells TypeScript so.
  const value = (key: string) => env[key] ?? ''
  return {
    apiKey: value(REQUIRED.apiKey),
    appId: value(REQUIRED.appId),
    authDomain: value(REQUIRED.authDomain),
    messagingSenderId: value(REQUIRED.messagingSenderId),
    projectId: value(REQUIRED.projectId),
  }
}
