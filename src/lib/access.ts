import { type User, onAuthStateChanged } from 'firebase/auth'
import { doc, onSnapshot } from 'firebase/firestore'
import { useEffect, useState } from 'react'
import { auth, db } from './firebase'

export type Access =
  | { state: 'loading' }
  | { state: 'signed-out' }
  | { state: 'denied', user: User }
  | { state: 'allowed', user: User }
  | { state: 'error', user: User, message: string }

/**
 * Whether the signed-in account is on the allowlist, kept live: the entry is watched, so access
 * follows changes made in the console, works offline from the cached entry, and re-checks once the
 * connection returns. A missing entry only counts as "denied" once the server has confirmed it, never
 * from the cache alone. Each sign-in gets its own listener, torn down on sign-out or account switch,
 * so a slow answer for one account can never be shown for another.
 */
export function useAccess(): Access {
  const [access, setAccess] = useState<Access>({ state: 'loading' })

  useEffect(() => {
    let stopWatchingEntry = () => {}
    const stopWatchingAuth = onAuthStateChanged(auth, user => {
      stopWatchingEntry()
      if (!user) {
        setAccess({ state: 'signed-out' })
        return
      }
      setAccess({ state: 'loading' })
      stopWatchingEntry = onSnapshot(
        doc(db, 'allowlist', user.uid),
        { includeMetadataChanges: true },
        entry => {
          if (entry.exists()) {
            setAccess({ state: 'allowed', user })
          } else if (!entry.metadata.fromCache) {
            setAccess({ state: 'denied', user })
          }
        },
        error => setAccess({ message: error.message, state: 'error', user }),
      )
    })
    return () => {
      stopWatchingAuth()
      stopWatchingEntry()
    }
  }, [])

  return access
}
