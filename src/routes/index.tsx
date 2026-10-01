import { createFileRoute } from '@tanstack/react-router'
import { GoogleAuthProvider, signInWithPopup, signOut } from 'firebase/auth'
import { useAccess } from '../lib/access'
import { auth } from '../lib/firebase'

export const Route = createFileRoute('/')({
  component: Home,
})

const button = 'rounded-lg bg-orange-600 px-4 py-2 font-semibold text-white hover:bg-orange-700'
const secondaryButton = 'rounded-lg border border-stone-300 px-4 py-2 font-medium dark:border-stone-700'

function Home() {
  const access = useAccess()

  return (
    <section className="space-y-6">
      <h1 className="text-3xl font-bold">Household Brain</h1>
      {access.state === 'loading' && <p>Loading…</p>}
      {access.state === 'signed-out' && (
        <button type="button" className={button} onClick={() => signInWithPopup(auth, new GoogleAuthProvider())}>
          Sign in with Google
        </button>
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
      {access.state === 'allowed' && (
        <div className="space-y-3">
          <p className="text-lg">
            Hello,
            {' '}
            {access.user.displayName ?? access.user.email}
            . You're on the allowlist.
          </p>
          <button type="button" className={secondaryButton} onClick={() => signOut(auth)}>Sign out</button>
        </div>
      )}
      {access.state === 'error' && (
        <div role="alert" className="space-y-3">
          <p className="font-semibold">Couldn't check access.</p>
          <p className="text-sm text-stone-500">{access.message}</p>
          <button type="button" className={secondaryButton} onClick={() => signOut(auth)}>Sign out</button>
        </div>
      )}
    </section>
  )
}
