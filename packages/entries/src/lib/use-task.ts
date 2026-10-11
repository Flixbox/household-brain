import { useState } from 'react'

export type TaskStatus =
  | { kind: 'idle' }
  | { kind: 'busy' }
  | { kind: 'done', message: string }
  | { kind: 'failed', message: string }

/** Runs one async action at a time and keeps its outcome as a message to show. */
export const useTask = () => {
  const [status, setStatus] = useState<TaskStatus>({ kind: 'idle' })
  const run = (action: () => Promise<string>) => {
    setStatus({ kind: 'busy' })
    action().then(message => {
      setStatus({ kind: 'done', message })
    }, (error: unknown) => {
      setStatus({ kind: 'failed', message: error instanceof Error ? error.message : String(error) })
    })
  }
  return { busy: status.kind === 'busy', run, status }
}
