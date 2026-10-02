import { atom } from 'nanostores'
import type { Item } from './model'
import { setItemStatus } from './store'
import { reportWriteFailure } from './write-failures'

/** The entry marked done by the last swipe, for the "Undo" message; null once it is gone. */
export const $lastDone = atom<{ item: Item } | null>(null)

let clearTimer: ReturnType<typeof setTimeout> | null = null
const UNDO_MS = 6000

/** Marks an open entry done, and offers to undo it for a few seconds. */
export const markDone = (item: Item) => {
  setItemStatus(item, 'done').catch(reportWriteFailure)
  $lastDone.set({ item })
  if (clearTimer) {
    clearTimeout(clearTimer)
  }
  clearTimer = setTimeout(() => $lastDone.set(null), UNDO_MS)
}

/** Puts the entry marked done last back to open. */
export const undoDone = () => {
  const last = $lastDone.get()
  if (last) {
    setItemStatus({ ...last.item, status: 'done' }, last.item.status).catch(reportWriteFailure)
    $lastDone.set(null)
  }
}
