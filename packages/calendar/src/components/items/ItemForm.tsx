import { type FormEvent, useState } from 'react'
import type { Category } from '../../lib/categories'
import type { ItemDraft } from '../../lib/items/model'
import { primaryButton, textField } from '../settings/styles'
import { Field } from './Field'
import { LINK_PATTERN, normaliseLink } from '../../lib/items/link'

interface Props {
  initial: ItemDraft
  categories: Category[]
  onSave: (draft: ItemDraft) => Promise<unknown>
}

/** The add/edit form. The due date is a date only: every entry is due at 17:00. */
export function ItemForm({ initial, categories, onSave }: Props) {
  const [draft, setDraft] = useState(initial)
  const [saving, setSaving] = useState(false)
  const set = (field: keyof ItemDraft) => (event: { target: { value: string } }) => setDraft(current => ({ ...current, [field]: event.target.value }))
  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (saving) {
      return null
    }
    setSaving(true)
    return onSave({ ...draft, title: draft.title.trim(), url: normaliseLink(draft.url) })
  }
  return (
    <form className="grid gap-4" onSubmit={submit}>
      <Field label="Title" required><input required pattern=".*\S.*" title="Enter a title" className={textField} value={draft.title} onChange={set('title')} /></Field>
      <Field label="Category" required>
        <select required className={textField} value={draft.category} onChange={set('category')}>
          <option value="" disabled>Choose…</option>
          {categories.map(category => <option key={category.slug} value={category.slug}>{category.label}</option>)}
        </select>
      </Field>
      <Field label="Due date (17:00)" required><input required type="date" className={textField} value={draft.dueDate} onChange={set('dueDate')} /></Field>
      <Field label="Code"><input className={textField} value={draft.code} onChange={set('code')} /></Field>
      <Field label="Amount"><input inputMode="decimal" pattern="[0-9]+([.,][0-9]{1,2})?" title="A number, e.g. 9.99" className={textField} value={draft.amount} onChange={set('amount')} /></Field>
      <Field label="Link">
        <input inputMode="url" autoCapitalize="none" pattern={LINK_PATTERN} title="A web address, e.g. example.de or https://example.de/deal" placeholder="example.de" className={textField} value={draft.url} onChange={set('url')} />
      </Field>
      <Field label="Notes"><textarea rows={3} className={textField} value={draft.notes} onChange={set('notes')} /></Field>
      <button type="submit" className={primaryButton} disabled={saving}>Save</button>
    </form>
  )
}
