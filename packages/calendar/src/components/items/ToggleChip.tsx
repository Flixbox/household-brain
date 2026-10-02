import type { ReactNode } from 'react'

/**
 * A toggle button shaped like a chip. It keeps one name; whether it is on is aria-pressed (and the
 * filled look).
 */
export const ToggleChip = ({ pressed, onToggle, disabled = false, children }: { pressed: boolean, onToggle: () => void, disabled?: boolean, children: ReactNode }) => (
  <button
    type="button"
    aria-pressed={pressed}
    disabled={disabled}
    onClick={onToggle}
    className="rounded-full border border-stone-300 px-3 py-1 text-sm font-medium aria-pressed:border-orange-600 aria-pressed:bg-orange-600 aria-pressed:text-white disabled:opacity-40 dark:border-stone-700"
  >
    {children}
  </button>
)
