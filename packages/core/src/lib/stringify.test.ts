import { describe, expect, it } from 'bun:test'
import { stringify } from './stringify'

describe('stringify', () => {
  // A value that is undefined without writing `undefined`.
  const unset: { cause?: Error } = {}

  it('keeps a string as it is', () => {
    expect(stringify('offline')).toBe('offline')
  })

  it("gives an error's message, and its cause when it has one", () => {
    expect(stringify(new Error('Sync failed'))).toBe('Sync failed')
    expect(stringify(new Error('Sync failed', { cause: new Error('403 Forbidden') }))).toBe('Sync failed (cause: 403 Forbidden)')
  })

  it('writes simple values as they read', () => {
    expect([stringify(404), stringify(true), stringify(null), stringify(Symbol('x'))]).toEqual(['404', 'true', 'null', 'Symbol(x)'])
  })

  it('writes an object as JSON instead of [object Object]', () => {
    expect(stringify({ error: { code: 403, message: 'Forbidden' } })).toBe('{"error":{"code":403,"message":"Forbidden"}}')
  })

  it('leaves out a cause that is undefined or loops back to the error itself', () => {
    const looping = new Error('Sync failed')
    looping.cause = looping
    expect([stringify(new Error('Sync failed', { cause: unset.cause })), stringify(looping)]).toEqual(['Sync failed', 'Sync failed'])
  })

  it('names what JSON cannot hold', () => {
    const looped: Record<string, unknown> = {}
    looped.self = looped
    expect([stringify(looped), stringify(() => null), stringify({ toJSON: () => null })]).toEqual(['[object Object]', '[object Function]', 'null'])
    expect(stringify({ toJSON: () => unset.cause })).toBe('[object Object]')
  })
})
