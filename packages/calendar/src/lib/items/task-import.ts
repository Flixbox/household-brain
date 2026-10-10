import { DEFAULT_CATEGORIES } from '@household-brain/calendar/lib/categories'
import type { GoogleTask } from '@household-brain/calendar/lib/tasks/api'
import { Temporal } from 'temporal-polyfill'
import { type ItemDraft, emptyDraft } from './model'
import { PLAIN_NUMBER } from './amount'
import { isDate } from './dates'
import { intervalFrom } from './interval'

const KNOWN_FIELDS = ['v', 'title', 'category', 'dueDate', 'startDate', 'code', 'amount', 'currency', 'interval', 'url', 'notes'] as const
type KnownField = typeof KNOWN_FIELDS[number]

export type TaskPayload = Record<string, unknown>

export interface ImportedTask {
  taskId: string
  draft: ItemDraft
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

const fieldOf = (key: string): KnownField | null => KNOWN_FIELDS.find(field => field === key) ?? null

const nullableText = (value: unknown): boolean => value === null || typeof value === 'string'

const hasRightType = (field: KnownField, value: unknown): boolean => {
  switch (field) {
    case 'v': return typeof value === 'number' && Number.isFinite(value)
    case 'title':
    case 'category': return typeof value === 'string'
    case 'amount':
    case 'code':
    case 'currency':
    case 'dueDate':
    case 'interval':
    case 'notes':
    case 'startDate':
    case 'url': return nullableText(value)
    default: return false
  }
}

const sourceOf = (notes: string): string => {
  const trimmed = notes.trim()
  // The Gem asks for bare JSON. An exact JSON markdown fence is harmless to unwrap, while any
  // prose around it stays rejected so a human note cannot accidentally become an entry.
  return /^```json\r?\n(?<json>[\s\S]*?)\r?\n```$/u.exec(trimmed)?.groups?.json ?? trimmed
}

const jsonOf = (source: string): unknown => {
  try {
    return JSON.parse(source)
  } catch {
    return null
  }
}

/** Parses one whole Tasks note, accepting only a clean object or one exact JSON fence. */
export const parseTaskNotes = (notes: string | null | undefined): TaskPayload | null => {
  if (typeof notes !== 'string' || notes.trim() === '') {
    return null
  }
  const parsed = jsonOf(sourceOf(notes))
  // At least one field that says something about an entry: a bare version marker isn't enough.
  if (!isRecord(parsed) || !Object.entries(parsed).some(([key, value]) => {
    const field = fieldOf(key)
    return field !== null && field !== 'v' && hasRightType(field, value)
  })) {
    return null
  }
  return parsed
}

const text = (value: unknown): string => typeof value === 'string' ? value : ''

const date = (value: unknown): string => {
  if (!isDate(value)) {
    return ''
  }
  try {
    Temporal.PlainDate.from(value)
    return value
  } catch {
    return ''
  }
}

const category = (value: unknown): string => {
  const candidate = text(value)
  return DEFAULT_CATEGORIES.some(entry => entry.slug === candidate) ? candidate : 'paperwork'
}

const amount = (value: unknown): string => {
  const candidate = text(value).trim()
  return PLAIN_NUMBER.test(candidate) ? candidate : ''
}

const currency = (value: unknown): string => {
  const candidate = text(value).trim().toUpperCase()
  return candidate === 'EUR' || !/^[A-Z]{3}$/u.test(candidate) ? '' : candidate
}

/** Maps a valid Tasks payload into the same draft shape the add-entry form writes. */
export const importedTask = (task: GoogleTask): ImportedTask | null => {
  const payload = parseTaskNotes(task.notes)
  if (!payload || task.id === '') {
    return null
  }
  const taskTitle = text(task.title)
  const payloadTitle = text(payload.title)
  return {
    draft: {
      ...emptyDraft(category(payload.category)),
      amount: amount(payload.amount),
      code: text(payload.code),
      currency: currency(payload.currency),
      dueDate: date(payload.dueDate),
      interval: intervalFrom(payload.interval),
      notes: text(payload.notes),
      startDate: date(payload.startDate),
      title: payloadTitle.trim() === '' ? taskTitle : payloadTitle,
      url: text(payload.url),
    },
    taskId: task.id,
  }
}
