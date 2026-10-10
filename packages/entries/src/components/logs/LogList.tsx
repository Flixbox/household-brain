import { Link } from '@tanstack/react-router'
import { useStore } from '@nanostores/react'
import { useEffect } from 'react'
import { $user } from '@household-brain/firebase/user'
import { logTime } from '@household-brain/entries/lib/logs-messages'
import { pruneOldLogs, useLogs } from '@household-brain/entries/lib/logs'
import { useItems } from '@household-brain/entries/lib/items/use-items'

const marker = {
  error: 'bg-red-600',
  event: 'bg-orange-500',
} as const

export const LogList = () => {
  const items = useItems()
  const logs = useLogs()
  const user = useStore($user)

  useEffect(() => {
    pruneOldLogs()
  }, [])

  if (logs === null) {
    return <p>Loading…</p>
  }
  if (logs.length === 0) {
    return <p className="rounded-lg bg-stone-100 px-4 py-3 dark:bg-stone-800">No logs yet.</p>
  }
  return (
    <ol className="space-y-3" aria-label="Log entries">
      {logs.map(log => {
        const item = log.itemId ? items?.find(entry => entry.id === log.itemId) ?? null : null
        const actor = log.by === user?.uid ? 'You' : 'The other person'
        return (
          <li key={log.id} className="flex gap-3 rounded-lg bg-stone-50 px-3 py-3 dark:bg-stone-950">
            <span className={`mt-1.5 size-3 shrink-0 rounded-full ${marker[log.kind]}`} aria-label={log.kind} />
            <div className="min-w-0 flex-1">
              <p className="break-words">{log.message}</p>
              {item && (
                <Link
                  to="/items/$itemId"
                  params={{ itemId: item.id }}
                  className="text-orange-700 underline dark:text-orange-400"
                >
                  {item.title}
                </Link>
              )}
              <p className="mt-1 text-sm text-stone-500 dark:text-stone-400">
                {log.at ? logTime(log.at) : 'Waiting for time'}
                {' · '}
                {actor}
              </p>
            </div>
          </li>
        )
      })}
    </ol>
  )
}
