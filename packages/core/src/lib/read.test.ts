import { describe, expect, it } from 'bun:test'
import { isRecord, textOf } from './read'

describe('isRecord', () => {
  it('takes plain objects only', () => {
    expect([isRecord({ title: 'Coupon' }), isRecord({}), isRecord(null), isRecord([1]), isRecord('x')]).toEqual([true, true, false, false, false])
  })
})

describe('textOf', () => {
  it('reads a string, and anything else as the fallback', () => {
    expect([textOf('Coupon'), textOf(3), textOf(null, '-')]).toEqual(['Coupon', '', '-'])
  })
})
