import { useStore } from '@nanostores/react'
import { $showCompleted, toggleShowCompleted } from '@household-brain/entries/lib/items/show-completed'
import { ToggleChip } from './ToggleChip'

/** "Show completed (n)". It stays while it is on, so it can be switched off even once nothing is completed. */
export const CompletedToggle = ({ completed }: { completed: number }) => {
  const showCompleted = useStore($showCompleted)
  if (completed === 0 && !showCompleted) {
    return null
  }
  return <ToggleChip pressed={showCompleted} onToggle={toggleShowCompleted}>{`Show completed (${completed})`}</ToggleChip>
}
