import { useStore } from '@nanostores/react'
import { $menuOpen, openMenu } from '@household-brain/shell/lib/menu'

/** The bar at the top of every signed-in page: the app's name and the button that opens the menu. */
export const TopBar = () => {
  const open = useStore($menuOpen)
  return (
    <header className="mb-6 flex items-center justify-between">
      <span className="text-xl font-bold">Household Brain</span>
      <button
        type="button"
        aria-label="Menu"
        aria-expanded={open}
        aria-controls="app-menu"
        onClick={openMenu}
        className="-mr-2 rounded-lg p-2 hover:bg-stone-200 dark:hover:bg-stone-800"
      >
        <svg aria-hidden="true" viewBox="0 0 24 24" className="size-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <path d="M4 6h16M4 12h16M4 18h16" />
        </svg>
      </button>
    </header>
  )
}
