import { Link, createFileRoute } from '@tanstack/react-router'
import { useEffect } from 'react'
import { CalendarSection } from '@household-brain/entries/components/settings/CalendarSection'
import { ShareSection } from '@household-brain/entries/components/settings/ShareSection'
import { useHousehold } from '@household-brain/entries/lib/calendar/use-household'
import { loadGis } from '@household-brain/entries/lib/google-token'
import { auth } from '@household-brain/firebase/firebase'

const Settings = () => {
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

export const Route = createFileRoute('/settings')({
  component: Settings,
})
