import { Link, createFileRoute } from '@tanstack/react-router'
import { useHousehold } from '../lib/calendar/use-household'
import { auth } from '../lib/firebase'
import { signOutOfApp } from '../lib/session'

export const Route = createFileRoute('/')({
  component: Home,
})

function Home() {
  const user = auth.currentUser
  const household = useHousehold()
  return (
    <section className="space-y-6">
      <div className="flex items-baseline justify-between">
        <h1 className="text-3xl font-bold">Household Brain</h1>
        <Link to="/settings" className="text-orange-700 underline dark:text-orange-400">Settings</Link>
      </div>
      <p className="text-lg">
        Hello,
        {' '}
        {user?.displayName ?? user?.email}
        . You&apos;re on the allowlist.
      </p>
      {household.state === 'missing' && (
        <p className="rounded-lg bg-orange-100 px-4 py-3 text-orange-950 dark:bg-orange-950 dark:text-orange-100">
          The household calendar isn&apos;t set up yet.
          {' '}
          <Link to="/settings" className="font-semibold underline">Set it up in Settings</Link>
          .
        </p>
      )}
      <button
        type="button"
        className="rounded-lg border border-stone-300 px-4 py-2 font-medium dark:border-stone-700"
        onClick={() => signOutOfApp()}
      >
        Sign out
      </button>
    </section>
  )
}
