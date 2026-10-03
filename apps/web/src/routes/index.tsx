import { Link, createFileRoute } from '@tanstack/react-router'
import { ItemList } from '@household-brain/calendar/components/items/ItemList'
import { useHousehold } from '@household-brain/calendar/lib/calendar/use-household'
import { useCategories, useItems } from '@household-brain/calendar/lib/items/use-items'
import { useStore } from '@nanostores/react'
import { $user } from '@household-brain/firebase/user'

const Home = () => {
  const user = useStore($user)
  const household = useHousehold()
  const items = useItems()
  const categories = useCategories()
  return (
    <section className="space-y-6">
      {/* The top bar shows the app's name; the page still needs its own heading. */}
      <h1 className="sr-only">Entries</h1>
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
      {items && <ItemList items={items} categories={categories} />}
    </section>
  )
}

export const Route = createFileRoute('/')({
  component: Home,
})
