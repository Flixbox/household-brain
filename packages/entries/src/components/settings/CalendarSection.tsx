import { connectToHousehold, setUpHousehold } from '@household-brain/entries/lib/calendar/connect'
import type { HouseholdState } from '@household-brain/entries/lib/calendar/use-household'
import { useTask } from '@household-brain/entries/lib/use-task'
import { StatusLine } from './StatusLine'
import { primaryButton } from '@household-brain/entries/lib/styles'

export const CalendarSection = ({ household }: { household: HouseholdState }) => {
  const { busy, run, status } = useTask()
  return (
    <div className="space-y-3">
      <h2 className="text-xl font-semibold">Google Calendar</h2>
      {household.state === 'loading' && <p>Loading…</p>}
      {household.state === 'missing' && (
        <>
          <p>There is no household calendar yet. Create it once; it lives in your Google account.</p>
          <button type="button" className={primaryButton} disabled={busy} onClick={() => run(setUpHousehold)}>
            Create the household calendar
          </button>
        </>
      )}
      {household.state === 'ready' && (
        <>
          <p>
            Entries go to the shared
            {' '}
            <strong>Household Brain</strong>
            {' '}
            calendar. Connect it on each person&apos;s account so it shows up in their Google Calendar and
            notifies them 2 days and 1 day before.
          </p>
          <button
            type="button"
            className={primaryButton}
            disabled={busy}
            onClick={() => run(() => connectToHousehold(household.config))}
          >
            Connect my Google Calendar
          </button>
        </>
      )}
      <StatusLine status={status} />
    </div>
  )
}
