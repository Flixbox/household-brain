import { describe, expect, it } from 'vitest'
import { dateEventId, entryOfEvent } from './date-events'
import { isEventId, newEventId } from './ids'

describe('date events', () => {
  it('have ids Google accepts that never look like an entry id', () => {
    const entryId = newEventId()
    const id = dateEventId(entryId, newEventId().slice(0, 8))
    expect(isEventId(id)).toBe(true)
    expect(id).not.toHaveLength(entryId.length)
  })

  it("are told apart from an entry's own event by their link", () => {
    expect(entryOfEvent({ extendedProperties: { private: { 'hb.entry': 'abc' } } })).toBe('abc')
    expect(entryOfEvent({ extendedProperties: { private: { 'hb.category': 'coupon' } } })).toBeNull()
    expect(entryOfEvent({})).toBeNull()
  })
})
