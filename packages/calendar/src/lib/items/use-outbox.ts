import { useStore } from '@nanostores/react'
import { $outbox, type OutboxState } from './outbox-state'

/** What the outbox is waiting on, for the sync bar. */
export function useOutbox(): OutboxState {
  return useStore($outbox)
}
