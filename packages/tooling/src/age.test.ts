import { describe, expect, it } from 'bun:test'
import { hoursSince, tooYoung } from './age'

const now = Temporal.Instant.from('2026-10-11T12:00:00Z')
const DAY = 24 * 60 * 60

describe('tooYoung', () => {
  it('flags a release younger than the minimum and passes an older one', () => {
    expect(tooYoung(Temporal.Instant.from('2026-10-10T12:00:01Z'), 2 * DAY, now)).toBe(true)
    expect(tooYoung(Temporal.Instant.from('2026-10-09T11:59:59Z'), 2 * DAY, now)).toBe(false)
  })
})

describe('hoursSince', () => {
  it('counts whole hours', () => {
    expect(hoursSince(Temporal.Instant.from('2026-10-09T10:30:00Z'), now)).toBe(49)
  })
})
