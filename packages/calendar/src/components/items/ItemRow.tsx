import { Link } from '@tanstack/react-router'
import type { Item } from '../../lib/items/model'

/** One entry: title with its code underneath when it has one, due date, and a dot while it is not yet in Google Calendar. */
export function ItemRow({ item }: { item: Item }) {
  return (
    <li>
      <Link to="/items/$itemId" params={{ itemId: item.id }} className="flex items-baseline gap-3 rounded-lg px-3 py-2 hover:bg-stone-100 dark:hover:bg-stone-900">
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="font-medium">{item.title}</span>
          {item.code !== '' && <span className="font-mono text-sm break-all text-stone-600 select-all dark:text-stone-400">{item.code}</span>}
        </span>
        <span className="text-sm text-stone-500 tabular-nums">{item.dueDate}</span>
        {item.sync !== 'synced' && (
          <span className={`size-2 rounded-full ${item.sync === 'error' ? 'bg-red-600' : 'bg-orange-500'}`}>
            <span className="sr-only">{item.sync === 'error' ? 'Sync failed' : 'Syncing'}</span>
          </span>
        )}
      </Link>
    </li>
  )
}
