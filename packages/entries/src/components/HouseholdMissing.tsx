import { Link } from 'wouter'
import { useHousehold } from '@household-brain/entries/lib/calendar/use-household'
import { paths } from '@household-brain/entries/lib/paths'

/** Points to Settings while the household calendar isn't set up yet; shows nothing otherwise. */
export const HouseholdMissing = () => {
  const household = useHousehold()
  if (household.state !== 'missing') {
    return null
  }
  return (
    <p className="rounded-lg bg-orange-100 px-4 py-3 text-orange-950 dark:bg-orange-950 dark:text-orange-100">
      The household calendar isn&apos;t set up yet.
      {' '}
      <Link href={paths.settings} className="font-semibold underline">Set it up in Settings</Link>
      .
    </p>
  )
}
