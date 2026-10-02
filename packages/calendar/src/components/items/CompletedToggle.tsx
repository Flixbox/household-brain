import { useStore } from '@nanostores/react'
import { $showCompleted, toggleShowCompleted } from '../../lib/items/show-completed'

/**
 * "Show completed (n)". A toggle keeps one name; whether it is on is aria-pressed (and the filled
 * look). It stays while it is on, so it can be switched off even once nothing is completed.
 */
export function CompletedToggle({ completed }: { completed: number }) {
  const showCompleted = useStore($showCompleted)
  if (completed === 0 && !showCompleted) {
    return null
  }
  return (
    <button
      type="button"
      aria-pressed={showCompleted}
      onClick={toggleShowCompleted}
      className="rounded-full border border-stone-300 px-3 py-1 text-sm font-medium aria-pressed:border-orange-600 aria-pressed:bg-orange-600 aria-pressed:text-white dark:border-stone-700"
    >
      {`Show completed (${completed})`}
    </button>
  )
}
