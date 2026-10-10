import { describe, expect, it } from 'vitest'
import { CalendarApiError } from '@household-brain/entries/lib/calendar/api'
import { NeedsAccessError, isTransient } from './transient'

describe('isTransient', () => {
  it('retries network trouble, rate limits and server errors by itself', () => {
    expect(isTransient(new NeedsAccessError())).toBe(true)
    expect(isTransient(new TypeError('Failed to fetch'))).toBe(true)
    expect(isTransient(new CalendarApiError(429, 'slow down'))).toBe(true)
    expect(isTransient(new CalendarApiError(403, 'rate limit'))).toBe(true)
    expect(isTransient(new CalendarApiError(503, 'unavailable'))).toBe(true)
  })

  it('shows definite rejections as errors', () => {
    expect(isTransient(new CalendarApiError(400, 'bad request'))).toBe(false)
    expect(isTransient(new CalendarApiError(404, 'no such calendar'))).toBe(false)
  })
})
