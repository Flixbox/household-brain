import { type FormEvent, useState } from 'react'
import type { Category } from '../../lib/categories'
import type { ItemDraft } from '../../lib/items/model'
import { primaryButton, textField } from '../settings/styles'
import { Field } from './Field'

interface Props {
  initial: ItemDraft
  categories: Category[]
  onSave: (draft: ItemDraft) => Promise<void>
}

/** The add/edit form. The due date is a date only: every entry is due at 17:00. */
export function ItemForm({ initial, categories, onSave }: Props) {
  const [draft, setDraft] = useState(initial)
  const set = (field: keyof ItemDraft) => (event: { target: { value: string } }) => setDraft(current => ({ ...current, [field]: event.target.value }))
  const submit = (event: FormEvent) => {
    event.preventDefault()
    return onSave({ ...draft, title: draft.title.trim() })
  }
  return (
    <form className="grid gap-4" onSubmit={submit}>
      <Field label="Title"><input required className={textField} value={draft.title} onChange={set('title')} /></Field>
      <Field label="Category">
        <select required className={textField} value={draft.category} onChange={set('category')}>
          <option value="" disabled>Choose…</option>
          {categories.map(category => <option key={category.slug} value={category.slug}>{category.label}</option>)}
        </select>
      </Field>
      <Field label="Due date (17:00)"><input required type="date" className={textField} value={draft.dueDate} onChange={set('dueDate')} /></Field>
      <Field label="Code"><input className={textField} value={draft.code} onChange={set('code')} /></Field>
      <Field label="Amount"><input inputMode="decimal" className={textField} value={draft.amount} onChange={set('amount')} /></Field>
      <Field label="Link"><input type="url" className={textField} value={draft.url} onChange={set('url')} /></Field>
      <Field label="Notes"><textarea rows={3} className={textField} value={draft.notes} onChange={set('notes')} /></Field>
      <button type="submit" className={primaryButton}>Save</button>
    </form>
  )
}
