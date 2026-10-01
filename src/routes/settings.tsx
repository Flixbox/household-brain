import { Link, createFileRoute } from '@tanstack/react-router'
import { CalendarSection } from '../components/settings/CalendarSection'
import { ShareSection } from '../components/settings/ShareSection'
import { useHousehold } from '../lib/calendar/use-household'
import { auth } from '../lib/firebase'

export const Route = createFileRoute('/settings')({
  component: Settings,
})

function Settings() {
  const household = useHousehold()
  const isOwner = household.state === 'ready' && household.config.ownerUid === auth.currentUser?.uid
  return (
    <section className="space-y-8">
      <div className="flex items-baseline justify-between">
        <h1 className="text-3xl font-bold">Settings</h1>
        <Link to="/" className="text-orange-700 underline dark:text-orange-400">Back</Link>
      </div>
      <CalendarSection household={household} />
      {isOwner && <ShareSection config={household.config} />}
    </section>
  )
}
