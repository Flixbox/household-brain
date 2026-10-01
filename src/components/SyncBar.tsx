import { useState } from 'react'
import { retryItem } from '../lib/items/store'
import { syncNow, useOutbox } from '../lib/items/outbox'

const bar = 'flex flex-wrap items-center gap-3 rounded-lg px-4 py-3 text-sm'

/** Shows what is not in Google Calendar yet, and offers the click that Google access needs. */
export function SyncBar() {
  const { failed, needsAccess, waiting } = useOutbox()
  const [problem, setProblem] = useState('')
  const sync = () => syncNow().then(() => setProblem(''), (error: unknown) => setProblem(String(error)))
  return (
    <div role="status" aria-live="polite" className="space-y-2">
      {waiting > 0 && (
        <p className={`${bar} bg-stone-200 dark:bg-stone-800`}>
          <span className="flex-1">{waiting === 1 ? '1 change' : `${waiting} changes`} not yet in Google Calendar.</span>
          {needsAccess && <button type="button" className="font-semibold text-orange-700 dark:text-orange-400" onClick={sync}>Sync now</button>}
        </p>
      )}
      {failed.map(item => (
        <p key={item.id} className={`${bar} bg-red-100 text-red-950 dark:bg-red-950 dark:text-red-100`}>
          <span className="flex-1">
            Couldn&apos;t sync “
            {item.title}
            ”:
            {' '}
            {item.syncError}
          </span>
          <button type="button" className="font-semibold underline" onClick={() => retryItem(item)}>Retry</button>
        </p>
      ))}
      {problem && <p className={`${bar} bg-red-100 text-red-950 dark:bg-red-950 dark:text-red-100`}>{problem}</p>}
    </div>
  )
}
