import { useState } from 'react'
import { useUndatedAllowed } from '../../lib/items/use-undated'
import { type EditableField, type FormState, type ItemDraft, changedFields, editField, followUntouched, openForm } from '../../lib/items/model'

/**
 * The form's fields: what it shows, the newest version it has seen, and a setter per field. When
 * `initial` changes by value (a newer version arrived), fields not edited here follow it. The state
 * is adjusted during render, as React recommends instead of an effect. `edited`: a field was changed here.
 * `dateRequired`: the due date may be left empty only once every app handles that, and an entry being
 * edited that already has none may stay so.
 */
export function useEntryForm(initial: ItemDraft, { editing }: { editing: boolean }) {
  const [form, setForm] = useState<FormState>(() => openForm(initial))
  const [seen, setSeen] = useState(initial)
  if (changedFields(seen, initial).length > 0) {
    setSeen(initial)
    setForm(followUntouched(form, initial))
  }
  const set = (field: EditableField) => (event: { target: { value: string } }) => setForm(current => editField(current, field, event.target.value))
  const dateRequired = !useUndatedAllowed() && !(editing && initial.dueDate === '')
  return { dateRequired, draft: form.draft, edited: form.touched.length > 0, latest: form.latest, set }
}
