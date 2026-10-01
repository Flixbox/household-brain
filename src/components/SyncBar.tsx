import { Link } from '@tanstack/react-router'
import { useState } from 'react'
import { syncNow } from '../lib/items/outbox'
import { useOutbox } from '../lib/items/use-outbox'
import { retryItem } from '../lib/items/store'
import { dismissWriteFailures, reportWriteFailure, useWriteFailures } from '../lib/items/write-failures'

const bar = 'flex flex-wrap items-center gap-3 rounded-lg px-4 py-3 text-sm'
const errorBar = `${bar} bg-red-100 text-red-950 dark:bg-red-950 dark:text-red-100`
const message = (error: unknown) => (error instanceof Error ? error.message : String(error))

/** Shows what is not in Google Calendar yet, and offers the click that Google access needs. */
export function SyncBar() {
  const { failed, missingCalendar, needsAccess, waiting } = useOutbox()
  const writeFailures = useWriteFailures()
  const [problem, setProblem] = useState('')
  const sync = () => syncNow().then(() => setProblem(''), (error: unknown) => setProblem(message(error)))
  return (
    <div className="space-y-2">
      {waiting > 0 && (
        <div className={`${bar} bg-stone-200 dark:bg-stone-800`}>
          <p role="status" className="flex-1">{waiting === 1 ? '1 change' : `${waiting} changes`} not yet in Google Calendar.</p>
          {missingCalendar && <Link to="/settings" className="font-semibold underline">Set up the calendar</Link>}
          {needsAccess && !missingCalendar && <button type="button" className="font-semibold text-orange-700 dark:text-orange-400" onClick={sync}>Sync now</button>}
        </div>
      )}
      {failed.map(item => (
        <div key={item.id} className={errorBar}>
          <p role="alert" className="flex-1">Couldn&apos;t sync “{item.title}”: {item.syncError}</p>
          <button type="button" className="font-semibold underline" onClick={() => retryItem(item).catch(reportWriteFailure)}>Retry</button>
        </div>
      ))}
      {writeFailures.length > 0 && (
        <div className={errorBar}>
          <p role="alert" className="flex-1">Couldn&apos;t save: {writeFailures.join('; ')}</p>
          <button type="button" className="font-semibold underline" onClick={dismissWriteFailures}>Dismiss</button>
        </div>
      )}
      {problem && waiting > 0 && <p role="alert" className={errorBar}>{problem}</p>}
    </div>
  )
}
