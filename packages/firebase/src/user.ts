import { type User, onAuthStateChanged } from 'firebase/auth'
import { atom, onMount } from 'nanostores'
import { auth } from '@household-brain/firebase/firebase'

/**
 * The signed-in account, live, for screens to read with `useStore`: React Compiler treats a value
 * read straight from `auth.currentUser` during render as unchanging, so a screen would keep showing
 * the first account it saw (#84).
 */
export const $user = atom<User | null>(auth.currentUser)

// Catches up with the account at once when a screen starts reading, before the listener's first
// answer: on a page opened directly (e.g. after a reload), the value from module load is still empty.
onMount($user, () => {
  $user.set(auth.currentUser)
  return onAuthStateChanged(auth, user => { $user.set(user) })
})
