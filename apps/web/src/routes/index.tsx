import { Link, createFileRoute } from '@tanstack/react-router'
import { ItemList, useCategories, useHousehold, useItems } from '@household-brain/calendar'
import { auth } from '@household-brain/firebase'
import { signOutOfApp } from '../lib/session'

export const Route = createFileRoute('/')({
  component: Home,
})

function Home() {
  const user = auth.currentUser
  const household = useHousehold()
  const items = useItems()
  const categories = useCategories()
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
      <Link to="/items/new" className="inline-block rounded-lg bg-orange-600 px-4 py-2 font-semibold text-white hover:bg-orange-700">Add entry</Link>
      {items && <ItemList items={items} categories={categories} />}
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
