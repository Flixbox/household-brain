import { Link } from '@tanstack/react-router'
import { useStore } from '@nanostores/react'
import type { Item } from '../../lib/items/model'
import { type Urgency, rowDue, startLabel } from '../../lib/items/due'
import { $now } from '../../lib/items/now'
import { requestSyncAccess } from '../../lib/items/outbox'
import { markDone } from '../../lib/items/swipe'
import { useSwipeToDone } from './use-swipe'

const URGENCY_TEXT: Record<Urgency, string> = {
  later: 'text-stone-500',
  overdue: 'font-semibold text-red-700 dark:text-red-400',
  soon: 'font-semibold text-amber-700 dark:text-amber-400',
}

/**
 * One entry: title with its code underneath, when it is due (relative, coloured by urgency, and the
 * date), and a dot while it is not yet in Google Calendar. Done and cancelled entries say so instead.
 * `category` names its category, for lists that mix categories ("All by date"). Swiping an open
 * entry to the left marks it done.
 */
export function ItemRow({ item, category }: { item: Item, category?: string }) {
  const now = useStore($now)
  const due = rowDue(item, now)
  const since = startLabel(item.startDate, now)
  const { handlers, offset } = useSwipeToDone(() => {
    // Asks Google for access while the gesture still counts as a click, like Save does.
    requestSyncAccess()
    markDone(item)
  }, item.status === 'open')
  return (
    // The green "Done" shows behind the row while it is swiped.
    <li className="relative overflow-hidden rounded-lg">
      {offset < 0 && <span aria-hidden="true" className="absolute inset-y-0 right-0 flex items-center rounded-lg bg-green-700 px-4 text-sm font-semibold text-white">Done</span>}
      <Link
        to="/items/$itemId"
        params={{ itemId: item.id }}
        // A native link drag would take over the pointer and stop the swipe.
        draggable={false}
        onClickCapture={handlers.handleClickCapture}
        onPointerCancel={handlers.handlePointerCancel}
        onPointerDown={handlers.handlePointerDown}
        onPointerMove={handlers.handlePointerMove}
        onPointerUp={handlers.handlePointerUp}
        style={{ transform: offset < 0 ? `translateX(${offset}px)` : 'none' }}
        className="relative flex touch-pan-y items-baseline gap-3 rounded-lg bg-stone-50 px-3 py-2 select-none hover:bg-stone-100 dark:bg-stone-950 dark:hover:bg-stone-900"
      >
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="font-medium">{item.title}</span>
          {category && <span className="text-xs text-stone-500">{category}</span>}
          {item.code !== '' && <span className="font-mono text-sm break-all text-stone-600 select-all dark:text-stone-400">{item.code}</span>}
        </span>
        <span className="flex flex-col items-end text-sm">
          <span className={URGENCY_TEXT[due.urgency]}>{due.label}</span>
          <span className="text-xs text-stone-500 tabular-nums">{item.dueDate}</span>
          {since && <span className="text-xs text-stone-500 tabular-nums">{since}</span>}
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
