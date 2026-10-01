import { GoogleAuthProvider, signInWithPopup, signOut } from 'firebase/auth'
import { type ReactNode, useState } from 'react'
import { useAccess } from '../lib/access'
import { auth } from '../lib/firebase'

const button = 'rounded-lg bg-orange-600 px-4 py-2 font-semibold text-white hover:bg-orange-700'
const secondaryButton = 'rounded-lg border border-stone-300 px-4 py-2 font-medium dark:border-stone-700'

/** Renders its children only for allowlisted accounts; every route sits behind it. */
export function AccessGate({ children }: { children: ReactNode }) {
  const access = useAccess()
  const [signInError, setSignInError] = useState<string>()

  const signIn = async () => {
    setSignInError('')
    try {
      await signInWithPopup(auth, new GoogleAuthProvider())
    } catch (error) {
      setSignInError(error instanceof Error ? error.message : String(error))
    }
  }

  if (access.state === 'allowed') {
    return children
  }
  return (
    <section className="space-y-6">
      <h1 className="text-3xl font-bold">Household Brain</h1>
      {access.state === 'loading' && <p>Loading…</p>}
      {access.state === 'signed-out' && (
        <div className="space-y-3">
          <button type="button" className={button} onClick={signIn}>Sign in with Google</button>
          {signInError && <p role="alert" className="text-sm text-red-700 dark:text-red-400">{signInError}</p>}
        </div>
      )}
      {access.state === 'denied' && (
        <div className="space-y-3">
          <p className="text-lg font-semibold">This account has no access.</p>
          <p>
            Ask the owner to add your user id to the allowlist:
            {' '}
            <code data-testid="uid" className="rounded bg-stone-200 px-1.5 py-0.5 dark:bg-stone-800">{access.user.uid}</code>
          </p>
          <button type="button" className={secondaryButton} onClick={() => signOut(auth)}>Sign out</button>
        </div>
      )}
      {access.state === 'error' && (
        <div role="alert" className="space-y-3">
          <p className="font-semibold">Couldn&apos;t check access.</p>
          <p className="text-sm text-stone-500">{access.message}</p>
          <div className="flex gap-3">
            <button type="button" className={button} onClick={() => globalThis.location.reload()}>Retry</button>
            <button type="button" className={secondaryButton} onClick={() => signOut(auth)}>Sign out</button>
          </div>
        </div>
      )}
    </section>
  )
}
