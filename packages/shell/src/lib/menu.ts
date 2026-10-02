import { atom } from 'nanostores'

/** Whether the side drawer (the app menu) is open. */
export const $menuOpen = atom(false)

export function openMenu() {
  $menuOpen.set(true)
}

export function closeMenu() {
  $menuOpen.set(false)
}
