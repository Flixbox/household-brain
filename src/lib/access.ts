import { onAuthStateChanged, type User } from 'firebase/auth'
import { doc, getDocFromServer } from 'firebase/firestore'
import { useEffect, useState } from 'react'
import { auth, db } from './firebase'

export type Access =
  | { state: 'loading' }
  | { state: 'signed-out' }
  | { state: 'denied', user: User }
  | { state: 'allowed', user: User }
  | { state: 'error', user: User, message: string }

/**
 * Whether the signed-in account is on the allowlist. The allowlist is checked against the server,
 * never the offline cache, so a stale cached answer can't grant or withhold access.
 */
export function useAccess(): Access {
  const [access, setAccess] = useState<Access>({ state: 'loading' })

  useEffect(() => onAuthStateChanged(auth, async user => {
    if (!user) {
      setAccess({ state: 'signed-out' })
      return
    }
    setAccess({ state: 'loading' })
    try {
      const entry = await getDocFromServer(doc(db, 'allowlist', user.uid))
      setAccess(entry.exists() ? { state: 'allowed', user } : { state: 'denied', user })
    } catch (error) {
      setAccess({ state: 'error', user, message: error instanceof Error ? error.message : String(error) })
    }
  }), [])

  return access
}
