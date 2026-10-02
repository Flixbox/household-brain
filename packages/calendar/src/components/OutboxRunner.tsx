import { useEffect } from 'react'
import { startOutbox } from '../lib/items/outbox'

/** Keeps the outbox running while an allowlisted person uses the app. */
export function OutboxRunner() {
  useEffect(() => startOutbox(), [])
  return null
}
