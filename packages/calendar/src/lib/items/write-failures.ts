import { useStore } from '@nanostores/react'
import { atom } from 'nanostores'

// A local Firestore write only fails for real problems (rules rejected it, quota): offline it just
// waits. Such failures are collected here and shown by the sync bar.

const $writeFailures = atom<string[]>([])

export function reportWriteFailure(error: unknown) {
  $writeFailures.set([...$writeFailures.get(), error instanceof Error ? error.message : String(error)])
}

export function dismissWriteFailures() {
  $writeFailures.set([])
}

export function useWriteFailures(): string[] {
  return useStore($writeFailures)
}
