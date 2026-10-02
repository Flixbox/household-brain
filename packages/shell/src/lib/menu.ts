import { atom } from 'nanostores'

/** Whether the side drawer (the app menu) is open. */
export const $menuOpen = atom(false)

export const openMenu = () => {
  $menuOpen.set(true)
}

export const closeMenu = () => {
  $menuOpen.set(false)
}
