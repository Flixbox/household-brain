import { useSyncExternalStore } from 'react'

// A local Firestore write only fails for real problems (rules rejected it, quota): offline it just
// waits. Such failures are collected here and shown by the sync bar.

let failures: string[] = []
const listeners = new Set<() => void>()

export function reportWriteFailure(error: unknown) {
  failures = [...failures, error instanceof Error ? error.message : String(error)]
  for (const listener of listeners) {
    listener()
  }
}

export function dismissWriteFailures() {
  failures = []
  for (const listener of listeners) {
    listener()
  }
}

const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useWriteFailures(): string[] {
  return useSyncExternalStore(subscribe, () => failures)
}
