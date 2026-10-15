import { type SubmitEvent, useState } from 'react'
import type { Category } from '@household-brain/entries/lib/categories'
import type { ItemDraft } from '@household-brain/entries/lib/items/draft'
import { type Saved, useEntryForm } from './use-entry-form'
import { primaryButtonClass } from '@household-brain/entries/lib/styles'
import { CategoryField } from './CategoryField'
import { TextField } from './TextField'
import { StatusField } from './StatusField'
import { ExtraDatesField } from './ExtraDatesField'
import type { EntryDate } from '@household-brain/entries/lib/items/dates'
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
  onSave: (draft: ItemDraft, saved: Omit<Saved, 'draft'>) => void
  /** Offer the status (open, done, cancelled): when editing, not when adding. */
  withStatus?: boolean
}

const NO_DATES: EntryDate[] = []

/**
 * The add/edit form. The due date is a date only: every entry is due at 17:00. It is optional once
 * every person's app handles that: an entry without one (a balance that never expires) has no Google
 * Calendar event. When `initial` changes while the form is open (a newer version arrived), fields not
 * edited here follow it. Once something is edited, the form holds back a new version of the app, so
 * leaving the app to copy a code doesn't reload the page and lose the entry. The browser still checks
 * what the entry schema doesn't cover (a category the household offers, a required due date, the
 * extra dates); the schema checks the rest at Save.
 */
export const ItemForm = ({ initial, initialDates = NO_DATES, categories, onSave, withStatus = false }: Props) => {
  const [saving, setSaving] = useState(false)
  const { dateRequired, dates: { change: setDates, dates }, form, holdUpdates, remindersShown } = useEntryForm(initial, {
    categories, editing: withStatus, initialDates, onSave: ({ draft, ...rest }: Saved) => { onSave(draft, rest) },
  })
  const submit = (event: SubmitEvent) => {
    event.preventDefault()
    if (saving) {
      return
    }
    // Held until the schema has answered, so a double-tapped Save saves once.
    setSaving(true)
    form.handleSubmit().then(() => { setSaving(form.state.isSubmitSuccessful) }, () => { setSaving(false) })
  }
  return (
    <form className="grid gap-4" onSubmit={submit} data-hold-updates={holdUpdates}>
      <form.Field name="title">{field => <TextField label="Title" required field={field} />}</form.Field>
      <form.Field name="category">{field => <CategoryField field={field} categories={categories} />}</form.Field>
      <form.Field name="dueDate">
        {field => <TextField label="Due date (17:00)" kind="date" required={dateRequired} title={dateRequired ? 'Required until every phone runs the latest version' : 'Leave it empty for something that never expires, e.g. a gift card credit'} field={field} />}
      </form.Field>
      <form.Field name="startDate">
        {field => <TextField label="Start date (optional)" kind="date" title="When it started or becomes valid; not after the due date" field={field} />}
      </form.Field>
      <ExtraDatesField dates={dates} onChange={setDates} />
      {remindersShown && <form.Field name="reminders">{field => <RemindersField value={field.state.value} onChange={field.handleChange} />}</form.Field>}
      {withStatus && <form.Field name="status">{field => <StatusField value={field.state.value} onChange={field.handleChange} />}</form.Field>}
      <form.Field name="code">{field => <TextField label="Code" field={field} />}</form.Field>
      <form.Field name="amount">
        {amount => (
          <form.Field name="currency">
            {currency => (
              <form.Field name="interval">
                {interval => <AmountField amount={amount} currency={currency} interval={interval} />}
              </form.Field>
            )}
          </form.Field>
        )}
      </form.Field>
      <form.Field name="url">{field => <LinkField value={field.state.value} onChange={field.handleChange} errors={field.state.meta.errors} />}</form.Field>
      <form.Field name="notes">{field => <TextField label="Notes" kind="notes" field={field} />}</form.Field>
      <button type="submit" className={primaryButtonClass} disabled={saving}>Save</button>
    </form>
  )
}
