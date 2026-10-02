import { Link } from '@tanstack/react-router'
import { useStore } from '@nanostores/react'
import type { Item } from '../../lib/items/model'
import { type Urgency, dueStatus } from '../../lib/items/due'
import { $now } from '../../lib/items/now'

const URGENCY_TEXT: Record<Urgency, string> = {
  later: 'text-stone-500',
  overdue: 'font-semibold text-red-700 dark:text-red-400',
  soon: 'font-semibold text-amber-700 dark:text-amber-400',
}

/**
 * One entry: title with its code underneath, when it is due (relative, coloured by urgency, and the
 * date), and a dot while it is not yet in Google Calendar. Only open entries are coloured.
 */
export function ItemRow({ item }: { item: Item }) {
  const due = dueStatus(item.dueDate, useStore($now))
  const urgency = item.status === 'open' ? due.urgency : 'later'
  return (
    <li>
      <Link to="/items/$itemId" params={{ itemId: item.id }} className="flex items-baseline gap-3 rounded-lg px-3 py-2 hover:bg-stone-100 dark:hover:bg-stone-900">
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="font-medium">{item.title}</span>
          {item.code !== '' && <span className="font-mono text-sm break-all text-stone-600 select-all dark:text-stone-400">{item.code}</span>}
        </span>
        <span className="flex flex-col items-end text-sm">
          <span className={URGENCY_TEXT[urgency]}>{due.label}</span>
          <span className="text-xs text-stone-500 tabular-nums">{item.dueDate}</span>
        </span>
        {item.sync !== 'synced' && (
          <span className={`size-2 rounded-full ${item.sync === 'error' ? 'bg-red-600' : 'bg-orange-500'}`}>
            <span className="sr-only">{item.sync === 'error' ? 'Sync failed' : 'Syncing'}</span>
          </span>
        )}
      </Link>
    </li>
  )
}
