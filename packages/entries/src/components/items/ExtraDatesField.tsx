import { DATE_LABELS, type EntryDate } from '@household-brain/entries/lib/items/dates'
import { newEventId } from '@household-brain/entries/lib/items/ids'
import { textField } from '@household-brain/entries/lib/styles'

const small = 'text-sm font-medium text-orange-700 dark:text-orange-400'

/**
 * More dates besides the due date ("Cancel by", "Valid from", …): a label (one of the suggestions or
 * any text) and a date each, added and removed freely. They show in the app only, without reminders.
 */
export const ExtraDatesField = ({ dates, onChange }: { dates: EntryDate[], onChange: (dates: EntryDate[]) => void }) => {
  const update = (id: string, changes: Partial<EntryDate>) => onChange(dates.map(entry => (entry.id === id ? { ...entry, ...changes } : entry)))
  return (
    <fieldset className="grid gap-2">
      <legend className="mb-1 text-sm font-medium">More dates (optional, in the app only)</legend>
      <datalist id="date-labels">{DATE_LABELS.map(label => <option key={label} value={label} />)}</datalist>
      {dates.map((entry, index) => (
        // Wraps on a phone (label on its own line), or the row would be wider than the screen.
        <div key={entry.id} className="flex flex-wrap items-center gap-2">
          <input aria-label={`Label of date ${index + 1}`} list="date-labels" required className={`${textField} min-w-0 basis-full sm:basis-0 sm:flex-1`} value={entry.label} onChange={event => update(entry.id, { label: event.target.value })} />
          <input aria-label={`Date ${index + 1}`} type="date" required className={`${textField} min-w-0 flex-1`} value={entry.date} onChange={event => update(entry.id, { date: event.target.value })} />
          <button type="button" aria-label={`Remove date ${index + 1}`} className={small} onClick={() => onChange(dates.filter(other => other.id !== entry.id))}>✕</button>
        </div>
      ))}
      <button type="button" className={`${small} justify-self-start`} onClick={() => onChange([...dates, { date: '', id: newEventId().slice(0, 8), label: '' }])}>+ Add date</button>
    </fieldset>
  )
}
