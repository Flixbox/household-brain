import { useStore } from '@nanostores/react'
import { $byDate, toggleByDate } from '@household-brain/calendar/lib/items/by-date'
import { CompletedToggle } from './CompletedToggle'
import { ToggleChip } from './ToggleChip'

/** "All by date", and "Show completed" except while searching (a search includes completed entries). */
export const BoardToggles = ({ completed, searching }: { completed: number, searching: boolean }) => {
  const byDate = useStore($byDate)
  return (
    <div className="flex flex-wrap gap-2">
      <ToggleChip pressed={byDate} onToggle={toggleByDate}>All by date</ToggleChip>
      {!searching && <CompletedToggle completed={completed} />}
    </div>
  )
}
