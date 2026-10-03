import { type User, onAuthStateChanged } from 'firebase/auth'
import { atom, onMount } from 'nanostores'
import { auth } from '@household-brain/firebase/firebase'

/**
 * The signed-in account, live, for screens to read with `useStore`: React Compiler treats a value
 * read straight from `auth.currentUser` during render as unchanging, so a screen would keep showing
 * the first account it saw (#84).
 */
export const $user = atom<User | null>(auth.currentUser)

onMount($user, () => onAuthStateChanged(auth, user => $user.set(user)))
