import { initializeApp } from 'firebase/app'
import { GoogleAuthProvider, connectAuthEmulator, getAuth, signInWithCredential } from 'firebase/auth'
import {
  connectFirestoreEmulator,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
} from 'firebase/firestore'
import { firebaseOptionsFrom } from './env'

// Each read is spelled out: the bundler inlines `process.env.BUN_PUBLIC_*` only where it is written literally.
export const app = initializeApp(firebaseOptionsFrom({
  BUN_PUBLIC_FIREBASE_API_KEY: process.env.BUN_PUBLIC_FIREBASE_API_KEY,
  BUN_PUBLIC_FIREBASE_APP_ID: process.env.BUN_PUBLIC_FIREBASE_APP_ID,
  BUN_PUBLIC_FIREBASE_AUTH_DOMAIN: process.env.BUN_PUBLIC_FIREBASE_AUTH_DOMAIN,
  BUN_PUBLIC_FIREBASE_MESSAGING_SENDER_ID: process.env.BUN_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  BUN_PUBLIC_FIREBASE_PROJECT_ID: process.env.BUN_PUBLIC_FIREBASE_PROJECT_ID,
}))
export const auth = getAuth(app)
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
})

// Compared inline (not through a helper) so the bundler folds it to `false` and drops this whole
// block, including the test sign-in hook, from production builds. apps/web/build.ts refuses a
// production build with the flag set, and CI checks dist/ for the hook.
if (process.env.BUN_PUBLIC_USE_EMULATORS === 'true') {
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true })
  connectFirestoreEmulator(db, '127.0.0.1', 8080)

  // End-to-end tests sign in without the Google popup: the Auth emulator accepts an unsigned
  // Google ID token. Only present in emulator builds.
  Object.assign(globalThis, {
    e2eSignIn: async (email: string) => signInWithCredential(auth, GoogleAuthProvider.credential(JSON.stringify({
      email,
      email_verified: true,
      name: email.split('@')[0],
      sub: email,
    }))),
  })
}
