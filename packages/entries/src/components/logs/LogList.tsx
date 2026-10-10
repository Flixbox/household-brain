import { useStore } from '@nanostores/react'
import { useEffect } from 'react'
import { $user } from '@household-brain/firebase/user'
import { pruneOldLogs, useLogs } from '@household-brain/entries/lib/logs'
import { useItems } from '@household-brain/entries/lib/items/use-items'
import { LogRow } from './LogRow'

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
    return <p className="rounded-lg bg-stone-100 px-4 py-3 dark:bg-stone-800">Nothing has happened yet.</p>
  }
  return (
    <ol className="space-y-3" aria-label="Events">
      {logs.map(log => {
        const item = log.itemId ? items?.find(entry => entry.id === log.itemId) ?? null : null
        const actor = log.by === user?.uid ? 'You' : 'The other person'
        return <LogRow key={log.id} log={log} item={item} actor={actor} />
      })}
    </ol>
  )
}
