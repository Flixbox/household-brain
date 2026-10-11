import { describe, expect, it } from 'bun:test'
import { stringify } from './stringify'

describe('stringify', () => {
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

  it('names what JSON cannot hold', () => {
    const looped: Record<string, unknown> = {}
    looped.self = looped
    expect([stringify(looped), stringify(() => null)]).toEqual(['[object Object]', '[object Function]'])
  })
})
