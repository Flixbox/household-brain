import { afterEach, describe, expect, it, vi } from 'vitest'
import { type Subscribe, dataOf, liveStore } from './live'

/** A fake Firestore listener the test drives by hand. */
function fakeListener() {
  const calls = { started: 0, stopped: 0 }
  let push: ((data: string) => void) | null = null
  let fail: ((error: Error) => void) | null = null
  const subscribe: Subscribe<string> = (next, error) => {
    calls.started += 1
    push = next
    fail = error
    return () => {
      calls.stopped += 1
    }
  }
  return { calls, fail: (message: string) => fail?.(new Error(message)), push: (data: string) => push?.(data), subscribe }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('liveStore', () => {
  it('listens once for all its readers, only while it has any, and forgets the data when it stops', () => {
    vi.useFakeTimers()
    const listener = fakeListener()
    const $store = liveStore(listener.subscribe)
    expect(listener.calls.started).toBe(0)

    const stopFirst = $store.listen(() => null)
    const stopSecond = $store.listen(() => null)
    expect(listener.calls.started).toBe(1)
    listener.push('hello')
    expect(dataOf($store.get())).toBe('hello')

    stopFirst()
    stopSecond()
    // A store stops a moment after its last reader leaves (nanostores).
    vi.runAllTimers()
    expect(listener.calls.stopped).toBe(1)
    expect($store.get()).toEqual({ state: 'loading' })
  })

  it('reports a failed listener', () => {
    const listener = fakeListener()
    const $store = liveStore(listener.subscribe)
    const stop = $store.listen(() => null)
    listener.fail('permission-denied')
    expect($store.get()).toEqual({ message: 'permission-denied', state: 'error' })
    expect(dataOf($store.get())).toBeNull()
    stop()
  })
})
