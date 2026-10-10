import type { DocumentData } from 'firebase/firestore'
import type { Category } from './categories'
import { type HouseholdConfig, TIME_ZONE } from './calendar/setup'
import type { EntryDate } from './items/dates'
import { type DateEventRecord, EDITABLE_FIELDS, type EditableField, type Item } from './items/model'
import { intervalFrom } from './items/interval'

/**
 * Firestore documents read into the app's types (#68). Field by field, with a fallback for anything
 * missing or of the wrong type: older app versions wrote fewer fields, and a stray document must
 * not take a screen down. Optional fields stay absent when the document has none.
 */

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

const text = (value: unknown, fallback = '') => (typeof value === 'string' ? value : fallback)

const textMap = (value: unknown): Record<string, string> =>
  (isRecord(value) ? Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === 'string')) : {})

const isEditableField = (value: unknown): value is EditableField => EDITABLE_FIELDS.some(field => field === value)

const STATUSES = ['open', 'done', 'cancelled'] as const
const SYNCS = ['pending', 'synced', 'error'] as const
const OPS = ['upsert', 'delete'] as const

const oneOf = <Choice extends string>(choices: readonly Choice[], value: unknown): Choice | undefined => choices.find(choice => choice === value)

const entryDateOf = (value: unknown): EntryDate[] => {
  if (!isRecord(value)) {
    return []
  }
  return [{ date: text(value.date), id: text(value.id), label: text(value.label) }]
}

const dateEventsOf = (value: Record<string, unknown>): Record<string, DateEventRecord> =>
  Object.fromEntries(Object.entries(value).filter(entry => isRecord(entry[1])).map(([id, record]) => {
    const { shape, error } = isRecord(record) ? record : {}
    return [id, { shape: text(shape), ...typeof error === 'string' ? { error } : {} }]
  }))

/** The fields only some entries have, left out when the document has none. */
const optionalFields = (data: DocumentData): Partial<Item> => ({
  ...Array.isArray(data.extraDates) ? { extraDates: data.extraDates.flatMap(entryDateOf) } : {},
  ...isRecord(data.dateEvents) ? { dateEvents: dateEventsOf(data.dateEvents) } : {},
  ...typeof data.googleUpdated === 'string' ? { googleUpdated: data.googleUpdated } : {},
  ...typeof data.taskId === 'string' ? { taskId: data.taskId } : {},
  ...'updatedAt' in data ? { updatedAt: data.updatedAt } : {},
  ...typeof data.updatedBy === 'string' ? { updatedBy: data.updatedBy } : {},
})

/** An `items/{id}` document. Its id is the document's own: every write goes to `items/{id}`. */
export const itemFrom = (id: string, data: DocumentData): Item => ({
  amount: text(data.amount),
  category: text(data.category),
  code: text(data.code),
  currency: text(data.currency),
  dirty: Array.isArray(data.dirty) ? data.dirty.filter(isEditableField) : [],
  dueDate: text(data.dueDate),
  etags: textMap(data.etags),
  id,
  interval: intervalFrom(data.interval),
  notes: text(data.notes),
  pendingOp: oneOf(OPS, data.pendingOp) ?? null,
  reminders: text(data.reminders),
  rev: text(data.rev),
  startDate: text(data.startDate),
  status: oneOf(STATUSES, data.status) ?? 'open',
  // A document without a known sync state is pushed again rather than taken as being in Google.
  sync: oneOf(SYNCS, data.sync) ?? 'pending',
  syncError: typeof data.syncError === 'string' ? data.syncError : null,
  title: text(data.title),
  url: text(data.url),
  ...optionalFields(data),
})

/** A `categories/{slug}` document. */
export const categoryFrom = (id: string, data: DocumentData): Category => ({
  colorId: text(data.colorId, '8'),
  label: text(data.label, id),
  slug: text(data.slug, id),
  sortOrder: typeof data.sortOrder === 'number' ? data.sortOrder : Number.MAX_SAFE_INTEGER,
})

/** The `meta/config` document; null when it lacks the calendar it describes. */
export const householdFrom = (data: DocumentData): HouseholdConfig | null =>
  (typeof data.calendarId === 'string' && data.calendarId !== ''
    ? { calendarId: data.calendarId, ownerUid: text(data.ownerUid), timeZone: text(data.timeZone, TIME_ZONE) }
    : null)
