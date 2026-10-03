import { useStore } from '@nanostores/react'
import { type MouseEvent, type ReactNode, useEffect, useRef } from 'react'
import { $menuOpen, closeMenu } from '@household-brain/shell/lib/menu'
import { signOutOfApp } from '@household-brain/shell/lib/session'

const item = 'block w-full rounded-lg px-3 py-2 text-left font-medium hover:bg-stone-100 dark:hover:bg-stone-800'

/**
 * The app menu: a modal drawer from the right with what the app puts in it (`children`) and
 * "Sign out". A native dialog, so focus stays inside and Escape closes it; so does a tap beside it.
 */
export const SideDrawer = ({ children }: { children: ReactNode }) => {
  const open = useStore($menuOpen)
  const dialog = useRef<HTMLDialogElement>(null)
  // Leaving the signed-in pages (e.g. losing access) leaves no open menu behind for the next visit.
  useEffect(() => closeMenu, [])
  useEffect(() => {
    if (open && !dialog.current?.open) {
      dialog.current?.showModal()
    } else if (!open && dialog.current?.open) {
      dialog.current.close()
    }
  }, [open])
  // A click on the dialog itself, not on anything inside it, is a click on the backdrop: the dialog
  // has no padding, so its own box is all nav.
  const closeOnBackdrop = (event: MouseEvent<HTMLDialogElement>) => {
    if (event.target === event.currentTarget) {
      closeMenu()
    }
  }
  return (
    <dialog
      ref={dialog}
      id="app-menu"
      aria-label="Menu"
      onClose={closeMenu}
      onClick={closeOnBackdrop}
      className="fixed inset-y-0 right-0 left-auto m-0 h-dvh max-h-none w-72 max-w-[85vw] bg-white p-0 text-stone-900 shadow-xl backdrop:bg-black/40 dark:bg-stone-900 dark:text-stone-100"
    >
      <nav className="flex h-full flex-col gap-1 p-4">
        <button type="button" onClick={closeMenu} className={`${item} mb-2 self-end`} aria-label="Close menu">✕</button>
        {children}
        <button
          type="button"
          className={`${item} mt-auto`}
          onClick={() => {
            closeMenu()
            return signOutOfApp()
          }}
        >
          Sign out
        </button>
      </nav>
    </dialog>
  )
}
