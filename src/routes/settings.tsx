import { Link, createFileRoute } from '@tanstack/react-router'
import { useEffect } from 'react'
import { CalendarSection } from '../components/settings/CalendarSection'
import { ShareSection } from '../components/settings/ShareSection'
import { useHousehold } from '../lib/calendar/use-household'
import { auth } from '../lib/firebase'
import { loadGis } from '../lib/google-token'

export const Route = createFileRoute('/settings')({
  component: Settings,
})

function Settings() {
  const household = useHousehold()
  useEffect(() => {
    // Preloading is best effort: a failure resurfaces, with its message, when a button is clicked.
    loadGis().catch(() => null)
  }, [])
  const isOwner = household.state === 'ready' && household.config.ownerUid === auth.currentUser?.uid
  return (
    <section className="space-y-8">
      <div className="flex items-baseline justify-between">
        <h1 className="text-3xl font-bold">Settings</h1>
        <Link to="/" className="text-orange-700 underline dark:text-orange-400">Back</Link>
      </div>
      <CalendarSection household={household} />
      {isOwner && <ShareSection />}
    </section>
  )
}
