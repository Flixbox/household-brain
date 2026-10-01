import { initializeApp } from 'firebase/app'
import { GoogleAuthProvider, connectAuthEmulator, getAuth, signInWithCredential } from 'firebase/auth'
import {
  connectFirestoreEmulator,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
} from 'firebase/firestore'
import { firebaseOptionsFrom } from './env'

export const app = initializeApp(firebaseOptionsFrom(import.meta.env))
export const auth = getAuth(app)
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
})

// Compared inline (not through a helper) so Vite folds it to `false` and drops this whole block,
// Including the test sign-in hook, from production builds. vite.config.ts refuses a production build
// With the flag set, and CI checks dist/ for the hook.
if (import.meta.env.VITE_USE_EMULATORS === 'true') {
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true })
  connectFirestoreEmulator(db, '127.0.0.1', 8080)

  // End-to-end tests sign in without the Google popup: the Auth emulator accepts an unsigned
  // Google ID token. Only present in emulator builds.
  Object.assign(window, {
    e2eSignIn: (email: string) => signInWithCredential(auth, GoogleAuthProvider.credential(JSON.stringify({
      email,
      email_verified: true,
      name: email.split('@')[0],
      sub: email,
    }))),
  })
}
