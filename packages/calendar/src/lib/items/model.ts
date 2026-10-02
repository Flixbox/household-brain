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
export function changedFields(before: ItemDraft, after: ItemDraft): EditableField[] {
  return EDITABLE_FIELDS.filter(field => before[field] !== after[field])
}

export interface FormState {
  /** What the form shows and saves. */
  draft: ItemDraft
  /** What each field was before the person edited it: saving sends only the fields that differ. */
  base: ItemDraft
}

/**
 * A newer version of the entry arrived (e.g. from Google) while the form is open: every field the
 * person hasn't edited takes the new value; edited fields keep theirs, and win when saved.
 * Returns `state` itself when nothing changes.
 */
export function followUntouched(state: FormState, next: ItemDraft): FormState {
  const adopt = EDITABLE_FIELDS.filter(field => state.draft[field] === state.base[field] && state.base[field] !== next[field])
  if (adopt.length === 0) {
    return state
  }
  const newer = Object.fromEntries(adopt.map(field => [field, next[field]]))
  return { base: { ...state.base, ...newer }, draft: { ...state.draft, ...newer } }
}
