import { type FormEvent, useState } from 'react'
import { type Category, offeredCategory } from '@household-brain/calendar/lib/categories'
import type { ItemDraft } from '@household-brain/calendar/lib/items/model'
import { useEntryForm } from './use-entry-form'
import { primaryButton, textField } from '@household-brain/calendar/lib/styles'
import { Field } from './Field'
import { StatusField } from './StatusField'
import { ExtraDatesField } from './ExtraDatesField'
import type { EntryDate } from '@household-brain/calendar/lib/items/dates'
import { LinkField } from './LinkField'
import { AmountField } from './AmountField'
import { RemindersField } from './RemindersField'

interface Props {
  initial: ItemDraft
  categories: Category[]
  /** The entry's extra dates when it opens. */
  initialDates?: EntryDate[]
  /**
   * `latest` is the newest version of the entry the form has seen (save what differs from it);
   * `dates` are its extra dates, `datesChanged` whether they were changed here.
   */
  onSave: (draft: ItemDraft, saved: { latest: ItemDraft, dates: EntryDate[], datesChanged: boolean }) => Promise<unknown>
  /** Offer the status (open, done, cancelled): when editing, not when adding. */
  withStatus?: boolean
}

const NO_DATES: EntryDate[] = []

/**
 * The add/edit form. The due date is a date only: every entry is due at 17:00. It is optional once
 * every person's app handles that: an entry without one (a balance that never expires) has no Google
 * Calendar event. When `initial`
 * changes while the form is open (a newer version arrived), fields not edited here follow it. Once
 * something is edited, the form holds back a new version of the app, so leaving the app to copy a
 * code doesn't reload the page and lose the entry.
 */
export const ItemForm = ({ initial, initialDates = NO_DATES, categories, onSave, withStatus = false }: Props) => {
  const { dateRequired, dates: { change: setDates, dates }, draft, holdUpdates, remindersShown, saved, set } = useEntryForm(initial, { editing: withStatus, initialDates })
  // Not an edit until saved: a category that arrives meanwhile (another device) still replaces it.
  const shownCategory = offeredCategory(draft.category, categories)
  const [saving, setSaving] = useState(false)
  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (saving) {
      return null
    }
    setSaving(true)
    const { draft: finished, ...rest } = saved
    return onSave({ ...finished, category: offeredCategory(finished.category, categories) }, rest)
  }
  return (
    <form className="grid gap-4" onSubmit={submit} data-hold-updates={holdUpdates}>
      <Field label="Title" required><input required pattern=".*\S.*" title="Enter a title" className={textField} value={draft.title} onChange={set('title')} /></Field>
      <Field label="Category" required>
        <select required className={textField} value={shownCategory} onChange={set('category')}>
          <option value="" disabled>Choose…</option>
          {categories.map(category => <option key={category.slug} value={category.slug}>{category.label}</option>)}
        </select>
      </Field>
      <Field label="Due date (17:00)" required={dateRequired}>
        <input type="date" required={dateRequired} title={dateRequired ? 'Required until every phone runs the latest version' : 'Leave it empty for something that never expires, e.g. a gift card credit'} className={textField} value={draft.dueDate} onChange={set('dueDate')} />
      </Field>
      <Field label="Start date (optional)">
        <input type="date" max={draft.dueDate || '9999-12-31'} title="When it started or becomes valid; not after the due date" className={textField} value={draft.startDate} onChange={set('startDate')} />
      </Field>
      <ExtraDatesField dates={dates} onChange={setDates} />
      {remindersShown && <RemindersField value={draft.reminders} onChange={set('reminders')} />}
      {withStatus && <StatusField value={draft.status} onChange={set('status')} />}
      <Field label="Code"><input className={textField} value={draft.code} onChange={set('code')} /></Field>
      <AmountField amount={draft.amount} currency={draft.currency} interval={draft.interval} onAmount={set('amount')} onCurrency={set('currency')} onInterval={set('interval')} />
      <LinkField value={draft.url} onChange={set('url')} />
      <Field label="Notes"><textarea rows={3} className={textField} value={draft.notes} onChange={set('notes')} /></Field>
      <button type="submit" className={primaryButton} disabled={saving}>Save</button>
    </form>
  )
}
