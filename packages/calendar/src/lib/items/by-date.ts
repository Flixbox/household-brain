import { persistentBoolean } from '@nanostores/persistent'

/** Whether the board shows one list sorted by due date instead of categories. Per device, off by default. */
export const $byDate = persistentBoolean('hb:by-date', false)

export function toggleByDate() {
  $byDate.set(!$byDate.get())
}
