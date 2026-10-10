import type { Timestamp } from 'firebase/firestore'
import { Temporal } from 'temporal-polyfill'
import { EDITABLE_FIELDS } from '@household-brain/entries/lib/items/model'

export const entryLogMessage = (action: string, title: string): string => `${action} "${title}"`

export const errorLogMessage = (message: string, title?: string): string => title ? `${message} "${title}"` : message

export const logTime = (at: Timestamp): string => Temporal.Instant.fromEpochMilliseconds(at.toMillis())
  .toZonedDateTimeISO(Temporal.Now.timeZoneId())
  .toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })

const DETAIL_LIMIT = 4000
const FIELD_NAMES: Record<string, string> = { dueDate: 'due date', startDate: 'start date' }

/** A log's detail as stored: web addresses left out (they can carry codes), and kept short. */
export const logDetail = (text: string): string => text.replace(/https?:\/\/\S+/gu, '[link]').slice(0, DETAIL_LIMIT)

/**
 * Which of an entry's fields changed, by name only: never their values (amounts, codes). Bookkeeping
 * fields (sync state, revisions) are left out.
 */
export const changedDetail = (fields: readonly string[]): string => {
  const named = fields.filter(field => EDITABLE_FIELDS.some(editable => editable === field))
  return named.length > 0 ? `Changed: ${named.map(field => FIELD_NAMES[field] ?? field).join(', ')}` : ''
}
