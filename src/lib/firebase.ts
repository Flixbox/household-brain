import { initializeApp } from 'firebase/app'
import { connectAuthEmulator, getAuth, GoogleAuthProvider, signInWithCredential } from 'firebase/auth'
import {
  connectFirestoreEmulator,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
} from 'firebase/firestore'
import { firebaseOptionsFrom, usesEmulators } from './env'

export const app = initializeApp(firebaseOptionsFrom(import.meta.env))
export const auth = getAuth(app)
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
})

if (usesEmulators(import.meta.env)) {
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true })
  connectFirestoreEmulator(db, '127.0.0.1', 8080)

  // End-to-end tests sign in without the Google popup: the Auth emulator accepts an unsigned
  // Google ID token. Only present in emulator builds.
  Object.assign(window, {
    e2eSignIn: (email: string) => signInWithCredential(auth, GoogleAuthProvider.credential(JSON.stringify({
      sub: email,
      email,
      email_verified: true,
      name: email.split('@')[0],
    }))),
  })
}
