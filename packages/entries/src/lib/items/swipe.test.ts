import { describe, expect, it } from 'vitest'
import { SWIPE_DONE_PX, swipedToDone } from './swipe-threshold'

describe('swipedToDone', () => {
  it('needs a swipe to the left of at least the threshold', () => {
    expect(swipedToDone(-SWIPE_DONE_PX)).toBe(true)
    expect(swipedToDone(-SWIPE_DONE_PX + 1)).toBe(false)
    expect(swipedToDone(SWIPE_DONE_PX * 2)).toBe(false)
  })
})
