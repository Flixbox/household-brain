import { describe, expect, it } from 'bun:test'
import { postedFrom, shownUsage, usageDue } from './watch-usage'

const MINUTE = 60_000
const shown = (minute: number, session: number, week = 30) => shownUsage({ five_hour: { utilization: session }, seven_day: { utilization: week } }, minute * MINUTE)

describe('usageDue (#318)', () => {
  it('posts the first line', () => {
    expect(usageDue(null, shown(0, 12))).toBe(true)
  })

  it('posts nothing for numbers in the same steps within 10 minutes', () => {
    const last = shown(0, 12, 30)
    expect([1, 5, 9.9].map(minute => usageDue(last, shown(minute, 12.4, 32.4)))).toEqual([false, false, false])
  })

  it('posts once when the week crosses 50%, and not again in that step', () => {
    const last = shown(0, 12, 48)
    expect(usageDue(last, shown(2, 12, 50.2))).toBe(true)
    expect(usageDue(shown(2, 12, 50.2), shown(4, 12, 51))).toBe(false)
  })

  it('posts when the session crosses a step, also downwards (a new window)', () => {
    expect(usageDue(shown(0, 9), shown(3, 10))).toBe(true)
    expect(usageDue(shown(0, 80), shown(3, 0))).toBe(true)
  })

  it('posts jitter around a step edge at most once within the debounce', () => {
    const posted = shown(0, 12, 50.1)
    expect(usageDue(posted, shown(0.5, 12, 49.9))).toBe(false)
    expect(usageDue(posted, shown(0.9, 12, 50.1))).toBe(false)
    expect(usageDue(posted, shown(1, 12, 49.9))).toBe(true)
  })

  it('posts a heartbeat 10 minutes after the last line, unchanged or not', () => {
    expect(usageDue(shown(0, 12), shown(10, 12))).toBe(true)
    // Unknown numbers (no login) stay unknown: only the heartbeat posts them again.
    const unknown = shownUsage(null, 0)
    expect(usageDue(unknown, shownUsage(null, 9 * MINUTE))).toBe(false)
    expect(usageDue(unknown, shownUsage(null, 10 * MINUTE))).toBe(true)
  })
})

describe('postedFrom', () => {
  it('reads back what was posted', () => {
    expect(postedFrom(JSON.stringify(shown(1, 12.5, 40)))).toEqual({ at: MINUTE, session: 12.5, week: 40 })
    expect(postedFrom('{"at":5,"session":null}')).toEqual({ at: 5, session: null, week: null })
  })

  it('reads nothing from a missing or broken line', () => {
    expect(postedFrom('')).toBeNull()
    expect(postedFrom('{"session":3}')).toBeNull()
    expect(postedFrom('[1]')).toBeNull()
  })
})
