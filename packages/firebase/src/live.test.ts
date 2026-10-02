import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RETRY_MS, type Subscribe, dataOf, liveStore } from './live'

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

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('reportError', vi.fn())
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('liveStore', () => {
  it('listens once for all its readers, only while it has any, and forgets the data when it stops', () => {
    const listener = fakeListener()
    const $store = liveStore(listener.subscribe)
    const seen: unknown[] = []
    expect(listener.calls.started).toBe(0)

    const stopFirst = $store.listen(value => seen.push(value))
    const stopSecond = $store.listen(() => null)
    expect(listener.calls.started).toBe(1)
    listener.push('hello')
    expect(seen).toEqual([{ data: 'hello', state: 'ready' }])

    stopFirst()
    stopSecond()
    // A store stops a moment after its last reader leaves (nanostores).
    vi.runAllTimers()
    expect(listener.calls).toEqual({ started: 1, stopped: 1 })
  })

  it('logs and reports a failed listener, then listens again while it is still read', () => {
    const listener = fakeListener()
    const $store = liveStore(listener.subscribe)
    const seen: unknown[] = []
    const stop = $store.listen(value => seen.push(value))
    listener.fail('permission-denied')
    expect(seen).toEqual([{ message: 'permission-denied', state: 'error' }])
    expect(dataOf({ message: 'x', state: 'error' })).toBeNull()
    expect(globalThis.reportError).toHaveBeenCalledWith(new Error('permission-denied'))

    vi.advanceTimersByTime(RETRY_MS)
    expect(listener.calls.started).toBe(2)
    listener.push('back')
    expect(seen.at(-1)).toEqual({ data: 'back', state: 'ready' })
    stop()
  })
})
