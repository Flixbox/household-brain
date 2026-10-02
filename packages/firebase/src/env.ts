import type { FirebaseOptions } from 'firebase/app'

const REQUIRED = {
  apiKey: 'VITE_FIREBASE_API_KEY',
  appId: 'VITE_FIREBASE_APP_ID',
  authDomain: 'VITE_FIREBASE_AUTH_DOMAIN',
  messagingSenderId: 'VITE_FIREBASE_MESSAGING_SENDER_ID',
  projectId: 'VITE_FIREBASE_PROJECT_ID',
} as const satisfies Record<string, keyof ImportMetaEnv>

/** Builds the Firebase options from the Vite env, failing loudly when a value is missing. */
export const firebaseOptionsFrom = (env: Partial<Record<string, string | undefined>>): FirebaseOptions => {
  const missing = Object.values(REQUIRED).filter(key => !env[key])
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
