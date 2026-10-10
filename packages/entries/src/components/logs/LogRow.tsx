import { Link } from '@tanstack/react-router'
import type { Log } from '@household-brain/entries/lib/documents'
import type { Item } from '@household-brain/entries/lib/items/model'
import { logTime } from '@household-brain/entries/lib/logs-messages'

const marker = {
  error: 'bg-red-600',
  event: 'bg-orange-500',
} as const

/** One row: a summary line that opens in place to show what changed or what went wrong. */
export const LogRow = ({ log, item, actor }: { log: Log, item: Item | null, actor: string }) => (
  <li className="rounded-lg bg-stone-50 dark:bg-stone-950">
    {/* Opens in place to show what changed or what went wrong, when, by whom, and the entry. */}
    <details className="group">
      <summary className="flex cursor-pointer list-none gap-3 px-3 py-3">
        <span className={`mt-1.5 size-3 shrink-0 rounded-full ${marker[log.kind]}`} aria-label={log.kind} />
        <span className="min-w-0 flex-1">
          <span className="block break-words">{log.message}</span>
          <span className="mt-1 block text-sm text-stone-500 dark:text-stone-400">
            {log.at ? logTime(log.at) : 'Waiting for time'}
            {' · '}
            {actor}
          </span>
        </span>
        <span aria-hidden="true" className="text-stone-400 transition-transform group-open:rotate-180">▾</span>
      </summary>
      <div className="space-y-2 border-t border-stone-200 px-3 py-3 pl-9 text-sm dark:border-stone-800">
        {log.detail && <p className="whitespace-pre-wrap break-words">{log.detail}</p>}
        <p className="text-stone-500 dark:text-stone-400">
          {log.kind === 'error' ? 'Error' : 'Event'}
          {' by '}
          {actor}
          {log.at ? `, ${logTime(log.at)}` : ''}
        </p>
        {item && (
          <Link to="/items/$itemId" params={{ itemId: item.id }} className="text-orange-700 underline dark:text-orange-400">
            Open “{item.title}”
          </Link>
        )}
        {log.itemId && !item && <p className="text-stone-500 dark:text-stone-400">The entry no longer exists.</p>}
      </div>
    </details>
  </li>
)
