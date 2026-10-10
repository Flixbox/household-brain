import { Timestamp } from 'firebase/firestore'
import { describe, expect, it } from 'vitest'
import { Temporal } from 'temporal-polyfill'
import { entryLogMessage, errorLogMessage, logTime } from '@household-brain/entries/lib/logs-messages'

describe('log messages', () => {
  it('describe an entry without adding its private fields', () => {
    expect(entryLogMessage('Added', 'Cinema 2 for 1')).toBe('Added "Cinema 2 for 1"')
    expect(errorLogMessage('Google refused', 'Cinema 2 for 1')).toBe('Google refused "Cinema 2 for 1"')
    expect(errorLogMessage('Google Calendar pull failed')).toBe('Google Calendar pull failed')
  })
})

describe('logTime', () => {
  it('formats a Firestore timestamp through Temporal', () => {
    const instant = Temporal.Instant.from('2026-10-10T12:34:00Z')
    expect(logTime(Timestamp.fromMillis(instant.epochMilliseconds))).toContain('2026')
  })
})
