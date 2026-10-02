import { type DocumentReference, type Query, onSnapshot } from 'firebase/firestore'
import { type ReadableAtom, atom, onMount } from 'nanostores'

/** Firestore data kept live in a store: loading until the first answer (often from the offline cache). */
export type Live<Value> =
  | { state: 'loading' }
  | { state: 'ready', data: Value }
  | { state: 'error', message: string }

const LOADING = { state: 'loading' } as const

/** Starts listening with `next` and `fail`; returns the function that stops. */
export type Subscribe<Value> = (next: (data: Value) => void, fail: (error: Error) => void) => () => void

/**
 * A store that listens only while something reads it: the first reader (a component through
 * `useStore`, or code calling `.subscribe`) starts the Firestore listener, the last one leaving stops
 * it, and every reader shares that one listener. When it stops it goes back to loading, so data never
 * outlives the listener (e.g. into the next signed-in account).
 */
export function liveStore<Value>(subscribe: Subscribe<Value>): ReadableAtom<Live<Value>> {
  const $store = atom<Live<Value>>(LOADING)
  onMount($store, () => {
    const stop = subscribe(data => $store.set({ data, state: 'ready' }), error => $store.set({ message: error.message, state: 'error' }))
    return () => {
      stop()
      $store.set(LOADING)
    }
  })
  return $store
}

/** The documents of a query, live. */
export const queryStore = <Value>(query: Query) =>
  liveStore<Value[]>((next, fail) => onSnapshot(query, snapshot => next(snapshot.docs.map(entry => entry.data() as Value)), fail))

/** One document, live; null while it doesn't exist. */
export const docStore = <Value>(ref: DocumentReference) =>
  liveStore<Value | null>((next, fail) => onSnapshot(ref, snapshot => next(snapshot.exists() ? snapshot.data() as Value : null), fail))

/** The data once it is there, else null (loading, or the listener failed). */
export const dataOf = <Value>(live: Live<Value>): Value | null => (live.state === 'ready' ? live.data : null)
