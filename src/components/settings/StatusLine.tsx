import type { TaskStatus } from '../../lib/use-task'

export function StatusLine({ status }: { status: TaskStatus }) {
  if (status.kind === 'done') {
    return <p role="status" className="text-sm text-green-700 dark:text-green-400">{status.message}</p>
  }
  if (status.kind === 'failed') {
    return <p role="alert" className="text-sm text-red-700 dark:text-red-400">{status.message}</p>
  }
  return null
}
