/** An entry as the app keeps it in Firestore (`items/{id}`); the id is also the Google event id. */
export interface Item {
  id: string
  title: string
  category: string
  /** ISO calendar date, `YYYY-MM-DD`; always due at 17:00 Europe/Berlin. */
  dueDate: string
  status: 'open' | 'done' | 'cancelled'
  code: string
  amount: string
  url: string
  notes: string
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
  /** Google's `updated` time of the event this entry last matched; older listings are ignored. */
  googleUpdated?: string
  updatedAt?: unknown
  /** Uid of the person who made the last local change. */
  updatedBy?: string
}

export const EDITABLE_FIELDS = ['title', 'category', 'dueDate', 'status', 'code', 'amount', 'url', 'notes'] as const
export type EditableField = typeof EDITABLE_FIELDS[number]
export type ItemDraft = Pick<Item, EditableField>

export const emptyDraft = (category = ''): ItemDraft => ({
  amount: '',
  category,
  code: '',
  dueDate: '',
  notes: '',
  status: 'open',
  title: '',
  url: '',
})

/** The fields whose value differs between two drafts. */
/** The editable fields of an entry. */
export const draftOf = (item: Item): ItemDraft => Object.fromEntries(EDITABLE_FIELDS.map(field => [field, item[field]])) as ItemDraft

export function changedFields(before: ItemDraft, after: ItemDraft): EditableField[] {
  return EDITABLE_FIELDS.filter(field => before[field] !== after[field])
}

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
export function editField(state: FormState, field: EditableField, value: string): FormState {
  return {
    ...state,
    draft: { ...state.draft, [field]: value },
    touched: state.touched.includes(field) ? state.touched : [...state.touched, field],
  }
}

/**
 * A newer version of the entry arrived (e.g. from Google) while the form is open: every field the
 * person hasn't touched takes the new value; touched fields keep theirs, and win when saved.
 * Returns `state` itself when nothing changes.
 */
export function followUntouched(state: FormState, next: ItemDraft): FormState {
  if (changedFields(state.latest, next).length === 0) {
    return state
  }
  const untouched = EDITABLE_FIELDS.filter(field => !state.touched.includes(field))
  const newer = Object.fromEntries(untouched.map(field => [field, next[field]]))
  return { ...state, draft: { ...state.draft, ...newer }, latest: next }
}
