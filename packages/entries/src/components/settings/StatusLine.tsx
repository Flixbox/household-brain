import type { TaskStatus } from '@household-brain/entries/lib/use-task'

const tone = {
  busy: 'text-stone-500',
  done: 'text-green-700 dark:text-green-400',
  failed: 'text-red-700 dark:text-red-400',
  idle: '',
} as const

/** Always present, so screen readers announce every change of the message. */
export const StatusLine = ({ status }: { status: TaskStatus }) => {
  const message = status.kind === 'done' || status.kind === 'failed' ? status.message : ''
  return (
    <p role="status" aria-live="polite" className={`min-h-5 text-sm ${tone[status.kind]}`}>
      {status.kind === 'busy' ? 'Working…' : message}
    </p>
  )
}
