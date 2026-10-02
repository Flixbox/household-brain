import { useState } from 'react'
import { type EditableField, type FormState, type ItemDraft, changedFields, editField, followUntouched, openForm } from '../../lib/items/model'

/**
 * The form's fields: what it shows, the newest version it has seen, and a setter per field. When
 * `initial` changes by value (a newer version arrived), fields not edited here follow it. The state
 * is adjusted during render, as React recommends instead of an effect. `edited`: a field was changed here.
 */
export function useEntryForm(initial: ItemDraft) {
  const [form, setForm] = useState<FormState>(() => openForm(initial))
  const [seen, setSeen] = useState(initial)
  if (changedFields(seen, initial).length > 0) {
    setSeen(initial)
    setForm(followUntouched(form, initial))
  }
  const set = (field: EditableField) => (event: { target: { value: string } }) => setForm(current => editField(current, field, event.target.value))
  return { draft: form.draft, edited: form.touched.length > 0, latest: form.latest, set }
}
