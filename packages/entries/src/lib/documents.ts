import { type DocumentData, Timestamp } from 'firebase/firestore'
import type { Category } from './categories'
import { type HouseholdConfig, TIME_ZONE } from './calendar/setup'
import type { EntryDate } from './items/dates'
import { type DateEventRecord, EDITABLE_FIELDS, type EditableField, type Item } from './items/model'
import { intervalFrom } from './items/interval'
import { isRecord, textMapOf, textOf } from '@household-brain/core/lib/read'

/**
 * Firestore documents read into the app's types (#68). Field by field, with a fallback for anything
 * missing or of the wrong type: older app versions wrote fewer fields, and a stray document must
 * not take a screen down. Optional fields stay absent when the document has none.
 */

const isEditableField = (value: unknown): value is EditableField => EDITABLE_FIELDS.some(field => field === value)

const STATUSES = ['open', 'done', 'cancelled'] as const
const SYNCS = ['pending', 'synced', 'error'] as const
const OPS = ['upsert', 'delete'] as const
const LOG_KINDS = ['error', 'event'] as const

export interface Log {
  id: string
  at: Timestamp | null
  by: string
  kind: typeof LOG_KINDS[number]
  message: string
  itemId?: string
  /** What the row shows when opened: the fields that changed, or what Google answered. */
  detail?: string
}

const oneOf = <Choice extends string>(choices: readonly Choice[], value: unknown): Choice | undefined => choices.find(choice => choice === value)

const entryDateOf = (value: unknown): EntryDate[] => {
  if (!isRecord(value)) {
    return []
  }
  return [{ date: textOf(value.date), id: textOf(value.id), label: textOf(value.label) }]
}

const dateEventsOf = (value: Record<string, unknown>): Record<string, DateEventRecord> =>
  Object.fromEntries(Object.entries(value).filter(entry => isRecord(entry[1])).map(([id, record]) => {
    const { shape, error } = isRecord(record) ? record : {}
    return [id, { shape: textOf(shape), ...typeof error === 'string' ? { error } : {} }]
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
  amount: textOf(data.amount),
  category: textOf(data.category),
  code: textOf(data.code),
  currency: textOf(data.currency),
  dirty: Array.isArray(data.dirty) ? data.dirty.filter(isEditableField) : [],
  dueDate: textOf(data.dueDate),
  etags: textMapOf(data.etags),
  id,
  interval: intervalFrom(data.interval),
  notes: textOf(data.notes),
  pendingOp: oneOf(OPS, data.pendingOp) ?? null,
  reminders: textOf(data.reminders),
  rev: textOf(data.rev),
  startDate: textOf(data.startDate),
  status: oneOf(STATUSES, data.status) ?? 'open',
  // A document without a known sync state is pushed again rather than taken as being in Google.
  sync: oneOf(SYNCS, data.sync) ?? 'pending',
  syncError: typeof data.syncError === 'string' ? data.syncError : null,
  title: textOf(data.title),
  url: textOf(data.url),
  ...optionalFields(data),
})

/** A `logs/{id}` document. */
export const logFrom = (id: string, data: DocumentData): Log => ({
  at: data.at instanceof Timestamp ? data.at : null,
  by: textOf(data.by),
  id,
  kind: oneOf(LOG_KINDS, data.kind) ?? 'event',
  message: textOf(data.message),
  ...typeof data.itemId === 'string' ? { itemId: data.itemId } : {},
  ...typeof data.detail === 'string' && data.detail !== '' ? { detail: data.detail } : {},
})

/** A `categories/{slug}` document. */
export const categoryFrom = (id: string, data: DocumentData): Category => ({
  colorId: textOf(data.colorId, '8'),
  label: textOf(data.label, id),
  slug: textOf(data.slug, id),
  sortOrder: typeof data.sortOrder === 'number' ? data.sortOrder : Number.MAX_SAFE_INTEGER,
})

/** The `meta/config` document; null when it lacks the calendar it describes. */
export const householdFrom = (data: DocumentData): HouseholdConfig | null =>
  (typeof data.calendarId === 'string' && data.calendarId !== ''
    ? { calendarId: data.calendarId, ownerUid: textOf(data.ownerUid), timeZone: textOf(data.timeZone, TIME_ZONE) }
    : null)
