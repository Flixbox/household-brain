import { describe, expect, it } from 'vitest'
import { dateEventId, entryOfEvent, isDateEventId } from './date-events'
import { isEventId, newEventId } from './ids'

describe('date events', () => {
  it('have ids Google accepts that never look like an entry id', () => {
    const entryId = newEventId()
    const id = dateEventId(entryId, newEventId().slice(0, 8))
    expect(isEventId(id)).toBe(true)
    expect(id).not.toHaveLength(entryId.length)
  })

  it("are told apart from an entry's own event by their id and link", () => {
    const entryId = 'abcdefghijklmnopqrstuv0123'
    const link = { 'hb.date': '01234567', 'hb.entry': entryId }
    expect(entryOfEvent({ extendedProperties: { private: link }, id: dateEventId(entryId, '01234567') })).toBe(entryId)
    // An entry's own event that somehow carries a link is still an entry's event.
    expect(entryOfEvent({ extendedProperties: { private: link }, id: entryId })).toBeNull()
    // The id and the link must agree.
    expect(entryOfEvent({ extendedProperties: { private: link }, id: dateEventId(entryId, '76543210') })).toBeNull()
    expect(entryOfEvent({ extendedProperties: { private: { 'hb.category': 'coupon' } }, id: entryId })).toBeNull()
    expect(isDateEventId(dateEventId(entryId, '01234567'))).toBe(true)
    expect(isDateEventId(entryId)).toBe(false)
  })
})
