import { useEffect } from 'react'
import { useStore } from '@nanostores/react'
import { $user } from '@household-brain/firebase/user'
import { ignoreFailure } from '@household-brain/core/lib/ignore'
import { useHousehold } from '@household-brain/entries/lib/calendar/use-household'
import { loadGis } from '@household-brain/entries/lib/google-token'
import { CalendarSection } from './CalendarSection'
import { ShareSection } from './ShareSection'

/** The household calendar's settings; sharing it is offered to its owner only. */
export const SettingsSections = () => {
  const household = useHousehold()
  const user = useStore($user)
  useEffect(() => {
    // Preloading is best effort: a failure resurfaces, with its message, when a button is clicked.
    loadGis().catch(ignoreFailure)
  }, [])
  const isOwner = household.state === 'ready' && household.config.ownerUid === user?.uid
  return (
    <>
      <CalendarSection household={household} />
      {isOwner && <ShareSection />}
    </>
  )
}
