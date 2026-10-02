import { useEffect } from 'react'
import { startOutbox } from '@household-brain/calendar/lib/items/outbox'
import { watchDefaultCategories } from '@household-brain/calendar/lib/calendar/default-categories'

/** Keeps the outbox running, and the default categories complete, while an allowlisted person uses the app. */
export const OutboxRunner = () => {
  useEffect(() => startOutbox(), [])
  useEffect(() => watchDefaultCategories(), [])
  return null
}
