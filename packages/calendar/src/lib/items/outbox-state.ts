import { atom } from 'nanostores'
import type { Item } from './model'

export interface OutboxState {
  waiting: number
  failed: Item[]
  /** Entries wait for Google access, which needs a click ("Sync now"). */
  needsAccess: boolean
  /** Entries wait because the household calendar hasn't been created yet. */
  missingCalendar: boolean
  /** Why the last pull from Google Calendar failed, unless that clears by itself. */
  pullProblem: string | null
}

/** What the outbox is waiting on, for the sync bar. Only the outbox writes it. */
export const $outbox = atom<OutboxState>({ failed: [], missingCalendar: false, needsAccess: false, pullProblem: null, waiting: 0 })
