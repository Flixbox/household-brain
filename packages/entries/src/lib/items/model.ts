import type { EntryDate } from './dates'
import type { ItemDraft } from './draft'

/** The ledger of one extra date's Google event. */
export interface DateEventRecord {
  shape: string
  error?: string
}

/**
 * An entry as the app keeps it in Firestore (`items/{id}`); the id is also the Google event id. Its
 * editable fields are the draft's (`draft.ts`); a field older entries lack is filled in when read.
 */
export interface Item extends ItemDraft {
  id: string
  /** Last Google etag seen, per user: reminders are per person, so etags can differ between users. */
  etags: Record<string, string>
  sync: 'pending' | 'synced' | 'error'
  pendingOp: 'upsert' | 'delete' | null
  /** Fields changed locally since the last successful push. */
  dirty: EditableField[]
  syncError: string | null
  /**
   * A fresh random value on every local write. A finished push compares it with the stored one to
   * tell whether the entry changed meanwhile (a server timestamp can't: it is still empty locally).
   */
  rev: string
  /**
   * More dates besides the due date (#34), e.g. "Cancel by". Each gets its own Google Calendar event
   * (`date-events.ts`) once every person's app recognises those. Absent on older entries.
   */
  extraDates?: EntryDate[]
  /**
   * What Google holds for each extra date's event, by date id: the shape last written there, and the
   * error when Google refused it. Comparing it with the entry tells which events to write or delete.
   */
  dateEvents?: Record<string, DateEventRecord>
  /** Google's `updated` time of the event this entry last matched; older listings are ignored. */
  googleUpdated?: string
  updatedAt?: unknown
  /** Uid of the person who made the last local change. */
  updatedBy?: string
  /** The Google Task that created this entry, when it came through the Tasks inbox. */
  taskId?: string
}

export const EDITABLE_FIELDS = ['title', 'category', 'dueDate', 'startDate', 'status', 'code', 'amount', 'currency', 'interval', 'url', 'notes', 'reminders'] as const
export type EditableField = typeof EDITABLE_FIELDS[number]

export const emptyDraft = (category = ''): ItemDraft => ({
  amount: '',
  category,
  code: '',
  currency: '',
  dueDate: '',
  interval: '',
  notes: '',
  reminders: '',
  startDate: '',
  status: 'open',
  title: '',
  url: '',
})

/** The editable fields of an entry. (A field older entries lack is filled in when read: `itemFrom`.) */
export const draftOf = (item: Item): ItemDraft => ({
  amount: item.amount,
  category: item.category,
  code: item.code,
  currency: item.currency,
  dueDate: item.dueDate,
  interval: item.interval,
  notes: item.notes,
  reminders: item.reminders,
  startDate: item.startDate,
  status: item.status,
  title: item.title,
  url: item.url,
})

/** The fields whose value differs between two drafts. */

export const changedFields = (before: ItemDraft, after: ItemDraft): EditableField[] =>
  EDITABLE_FIELDS.filter(field => before[field] !== after[field])

export interface FormState {
  /** What the form shows and saves. */
  draft: ItemDraft
  /** The newest version of the entry the form has seen. Saving sends what differs from it. */
  latest: ItemDraft
  /** Fields the person has typed in. They stay theirs, even when typed back to the old value. */
  touched: readonly EditableField[]
}

export const openForm = (entry: ItemDraft): FormState => ({ draft: entry, latest: entry, touched: [] })

/** The person typed in a field. */
export const editField = (state: FormState, field: EditableField, value: string): FormState => ({
  ...state,
  draft: { ...state.draft, [field]: value },
  touched: state.touched.includes(field) ? state.touched : [...state.touched, field],
})

/**
 * A newer version of the entry arrived (e.g. from Google) while the form is open: every field the
 * person hasn't touched takes the new value; touched fields keep theirs, and win when saved.
 * Returns `state` itself when nothing changes.
 */
export const followUntouched = (state: FormState, next: ItemDraft): FormState => {
  if (changedFields(state.latest, next).length === 0) {
    return state
  }
  const untouched = EDITABLE_FIELDS.filter(field => !state.touched.includes(field))
  const newer = Object.fromEntries(untouched.map(field => [field, next[field]]))
  return { ...state, draft: { ...state.draft, ...newer }, latest: next }
}
