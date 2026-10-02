import { useState } from 'react'
import { normaliseLink } from '../../lib/items/link'
import { useUndatedAllowed } from '../../lib/items/use-undated'
import { type EditableField, type FormState, type ItemDraft, changedFields, editField, followUntouched, openForm } from '../../lib/items/model'

/**
 * The form's fields: what it shows, the newest version it has seen, and a setter per field. When
 * `initial` changes by value (a newer version arrived), fields not edited here follow it. The state
 * is adjusted during render, as React recommends instead of an effect. `edited`: a field was changed here.
 * `dateRequired`: the due date may be left empty only once every app handles that, and an entry being
 * edited that already has none may stay so.
 * `finished`: the draft as it is saved, with the title trimmed and a bare domain as a full address.
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
  const finished = { ...form.draft, title: form.draft.title.trim(), url: normaliseLink(form.draft.url) }
  return { dateRequired, draft: form.draft, edited: form.touched.length > 0, finished, latest: form.latest, set }
}
