import { describe, expect, it } from 'bun:test'
import { unreadableLine, unreadableOnOverflow } from './shell-work'

describe('unreadableOnOverflow (#496)', () => {
  it('passes on what was read', () => {
    expect(unreadableOnOverflow(() => [['echo', 'hi']])).toEqual([['echo', 'hi']])
  })

  it('counts a stack overflow as an unreadable line', () => {
    const overflow = () => {
      throw new RangeError('Maximum call stack size exceeded')
    }
    expect(unreadableOnOverflow(overflow)).toEqual(unreadableLine())
  })

  it('lets any other failure through', () => {
    const failure = () => {
      throw new TypeError('not a stack overflow')
    }
    expect(() => unreadableOnOverflow(failure)).toThrow(TypeError)
  })
})
