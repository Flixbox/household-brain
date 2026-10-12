import { ItemList } from '@household-brain/entries/components/items/ItemList'
import { HouseholdMissing } from '@household-brain/entries/components/HouseholdMissing'
import { useCategories, useItems } from '@household-brain/entries/lib/items/use-items'
import { useStore } from '@nanostores/react'
import { $user } from '@household-brain/firebase/user'

export const Home = () => {
  const user = useStore($user)
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
      <HouseholdMissing />
      {items && <ItemList items={items} categories={categories} />}
    </section>
  )
}
