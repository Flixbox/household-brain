import { describe, expect, it } from 'bun:test'
import { hasText, isRecord, recordOf, textMapOf, textOf } from './read'

describe('isRecord', () => {
  it('takes plain objects only', () => {
    expect([isRecord({ title: 'Coupon' }), isRecord({}), isRecord(null), isRecord([1]), isRecord('x')]).toEqual([true, true, false, false, false])
  })
})

describe('hasText', () => {
  it('is true only for a non-empty string', () => {
    expect([hasText('Coupon'), hasText(''), hasText(null)]).toEqual([true, false, false])
  })
})

describe('textOf', () => {
  it('reads a string, and anything else as the fallback', () => {
    expect([textOf('Coupon'), textOf(3), textOf(null, '-')]).toEqual(['Coupon', '', '-'])
  })
})

describe('recordOf', () => {
  it('reads an object, and anything else as an empty one', () => {
    expect([recordOf({ id: 'x' }), recordOf(null), recordOf(['x'])]).toEqual([{ id: 'x' }, {}, {}])
  })
})

describe('textMapOf', () => {
  it('keeps only the string fields', () => {
    expect([textMapOf({ code: 'A1', count: 2 }), textMapOf('x')]).toEqual([{ code: 'A1' }, {}])
  })
})
