import { MAX_REMINDERS, REMINDER_CHOICES, reminderMinutes, remindersValue } from '../../lib/items/reminders'
import { ToggleChip } from './ToggleChip'

/**
 * When an open entry notifies, before its 17:00 due time (#35): any of the choices, up to five, or
 * none. It starts as each person's default, 2 days and 1 day. Every person's device applies the same
 * reminders to their own copy of the event, as Google keeps reminders per person.
 */
export function RemindersField({ value, onChange }: { value: string, onChange: (event: { target: { value: string } }) => void }) {
  const chosen = reminderMinutes(value)
  const toggle = (minutes: number) => {
    const next = chosen.includes(minutes) ? chosen.filter(other => other !== minutes) : [...chosen, minutes]
    onChange({ target: { value: remindersValue(next) } })
  }
  return (
    <fieldset className="grid gap-2">
      <legend className="mb-1 text-sm font-medium">Reminders</legend>
      <div className="flex flex-wrap gap-2">
        {REMINDER_CHOICES.map(choice => {
          const pressed = chosen.includes(choice.minutes)
          return <ToggleChip key={choice.minutes} pressed={pressed} disabled={!pressed && chosen.length >= MAX_REMINDERS} onToggle={() => toggle(choice.minutes)}>{choice.label}</ToggleChip>
        })}
      </div>
      <p className="text-xs text-stone-500">{chosen.length === 0 ? 'None: this entry never notifies.' : 'Before 17:00 on the due date, while it is open.'}</p>
    </fieldset>
  )
}
