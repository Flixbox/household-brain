import { createFileRoute } from '@tanstack/react-router'
import { signOut } from 'firebase/auth'
import { auth } from '../lib/firebase'

export const Route = createFileRoute('/')({
  component: Home,
})

function Home() {
  const user = auth.currentUser
  return (
    <section className="space-y-6">
      <h1 className="text-3xl font-bold">Household Brain</h1>
      <p className="text-lg">
        Hello,
        {' '}
        {user?.displayName ?? user?.email}
        . You&apos;re on the allowlist.
      </p>
      <button
        type="button"
        className="rounded-lg border border-stone-300 px-4 py-2 font-medium dark:border-stone-700"
        onClick={() => signOut(auth)}
      >
        Sign out
      </button>
    </section>
  )
}
