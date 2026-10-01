import { useSyncExternalStore } from 'react'
import { type OutboxState, outboxState, subscribeOutbox } from './outbox'

/** What the outbox is waiting on, for the sync bar. */
export function useOutbox(): OutboxState {
  return useSyncExternalStore(subscribeOutbox, outboxState)
}
