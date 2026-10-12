import { Entries } from '@household-brain/entries/components/items/Entries'
import { HouseholdMissing } from '@household-brain/entries/components/HouseholdMissing'
import { useStore } from '@nanostores/react'
import { $user } from '@household-brain/firebase/user'

export const Home = () => {
  const user = useStore($user)
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
      <Entries />
    </section>
  )
}
