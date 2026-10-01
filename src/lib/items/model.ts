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
  /** Firestore server timestamp of the last local change; lets a finished push detect newer edits. */
  updatedAt?: { isEqual: (other: unknown) => boolean } | null
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
