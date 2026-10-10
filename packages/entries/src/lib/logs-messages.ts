import type { Timestamp } from 'firebase/firestore'
import { Temporal } from 'temporal-polyfill'

export const entryLogMessage = (action: string, title: string): string => `${action} "${title}"`

export const errorLogMessage = (message: string, title?: string): string => title ? `${message} "${title}"` : message

export const logTime = (at: Timestamp): string => Temporal.Instant.fromEpochMilliseconds(at.toMillis())
  .toZonedDateTimeISO(Temporal.Now.timeZoneId())
  .toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })
