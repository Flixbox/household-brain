import { persistentBoolean } from '@nanostores/persistent'

/** Whether the board also lists done and cancelled entries. A per-device preference, off by default. */
export const $showCompleted = persistentBoolean('hb:show-completed', false)

export function toggleShowCompleted() {
  $showCompleted.set(!$showCompleted.get())
}
