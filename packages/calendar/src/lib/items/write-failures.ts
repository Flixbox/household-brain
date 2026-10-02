import { useStore } from '@nanostores/react'
import { atom } from 'nanostores'

// A local Firestore write only fails for real problems (rules rejected it, quota): offline it just
// waits. Such failures are collected here and shown by the sync bar.

const $writeFailures = atom<string[]>([])

export const reportWriteFailure = (error: unknown) => {
  $writeFailures.set([...$writeFailures.get(), error instanceof Error ? error.message : String(error)])
}

export const dismissWriteFailures = () => {
  $writeFailures.set([])
}

export const useWriteFailures = (): string[] =>
  useStore($writeFailures)
