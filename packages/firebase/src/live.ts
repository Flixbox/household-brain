import { type DocumentData, type DocumentReference, type Query, onSnapshot } from 'firebase/firestore'
import { type ReadableAtom, atom, onMount } from 'nanostores'

/** Firestore data kept live in a store: loading until the first answer (often from the offline cache). */
export type Live<Value> =
  | { state: 'loading' }
  | { state: 'ready', data: Value }
  | { state: 'error', message: string }

const LOADING = { state: 'loading' } as const

/** Starts listening with `next` and `fail`; returns the function that stops. */
export type Subscribe<Value> = (next: (data: Value) => void, fail: (error: Error) => void) => () => void

/** How long a failed listener waits before it listens again, while the store is still read. */
export const RETRY_MS = 10_000

/**
 * A store that listens only while something reads it: the first reader (a component through
 * `useStore`, or code calling `.subscribe` / `.listen`) starts the Firestore listener, the last one
 * leaving stops it, and every reader shares that one listener. When it stops it goes back to loading,
 * so data never outlives the listener (e.g. into the next signed-in account).
 *
 * A failed listener is logged, shown as `error`, and started again after `RETRY_MS` while readers
 * remain: Firestore ends a listener for good when it fails.
 *
 * Read it through a subscription, never with `.get()` alone: on a store nobody reads, `.get()`
 * starts a listener just for that moment and returns `loading`.
 */
export const liveStore = <Value>(subscribe: Subscribe<Value>): ReadableAtom<Live<Value>> => {
  const $store = atom<Live<Value>>(LOADING)
  onMount($store, () => {
    let stop: (() => void) | null = null
    let retry: ReturnType<typeof setTimeout> | null = null
    const start = () => {
      stop = subscribe(data => $store.set({ data, state: 'ready' }), error => {
        // Nobody reads it any more, e.g. right after sign-out, when the rules refuse the listener
        // that is still running for the short unmount delay: nothing to report.
        if ($store.lc === 0) {
          return
        }
        // Reported like an uncaught error (the browser logs it), which is what it was before.
        globalThis.reportError(error)
        $store.set({ message: error.message, state: 'error' })
        retry = setTimeout(start, RETRY_MS)
      })
    }
    start()
    return () => {
      stop?.()
      if (retry) {
        clearTimeout(retry)
      }
      $store.set(LOADING)
    }
  })
  return $store
}

/** The documents of a query, live, each read by `read` from its id and data. */
export const queryStore = <Value>(query: Query, read: (id: string, data: DocumentData) => Value) =>
  liveStore<Value[]>((next, fail) => onSnapshot(query, snapshot => next(snapshot.docs.map(entry => read(entry.id, entry.data()))), fail))

/** One document, live, read by `read`; null while it doesn't exist (or `read` finds nothing usable). */
export const docStore = <Value>(ref: DocumentReference, read: (data: DocumentData) => Value | null) =>
  liveStore<Value | null>((next, fail) => onSnapshot(ref, snapshot => next(snapshot.exists() ? read(snapshot.data()) : null), fail))

/** The data once it is there, else null (loading, or the listener failed). */
export const dataOf = <Value>(live: Live<Value>): Value | null => (live.state === 'ready' ? live.data : null)
