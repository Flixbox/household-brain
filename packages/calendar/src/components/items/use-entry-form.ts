import { useState } from 'react'
import type { EntryDate } from '@household-brain/calendar/lib/items/dates'
import { holdUpdatesValue } from '@household-brain/calendar/lib/update-hold'
import { useEntryDates } from './use-entry-dates'
import { normaliseLink } from '@household-brain/calendar/lib/items/link'
import { useRemindersAllowed, useUndatedAllowed } from '@household-brain/calendar/lib/items/use-undated'
import { type EditableField, type FormState, type ItemDraft, changedFields, editField, followUntouched, openForm } from '@household-brain/calendar/lib/items/model'

/**
 * The form's fields: what it shows, the newest version it has seen, and a setter per field. When
 * `initial` changes by value (a newer version arrived), fields not edited here follow it. The state
 * is adjusted during render, as React recommends instead of an effect. `edited`: a field was changed here.
 * `dateRequired`: the due date may be left empty only once every app handles that, and an entry being
 * edited that already has none may stay so.
 * `remindersShown`: the entry's own reminders are offered once every app handles them, and always
 * for an entry that already has some.
 * `fallbackCategory`: the category to start with when the entry's own isn't offered, '' for none.
 * `dates`: the extra dates (`useEntryDates`). `holdUpdates`: whether a new app version must wait, once
 * anything was edited. `saved`: what Save sends, with the title and date labels trimmed and a bare
 * domain as a full address.
 */
export const useEntryForm = (initial: ItemDraft, { editing, fallbackCategory, initialDates }: { editing: boolean, fallbackCategory: string, initialDates: EntryDate[] }) => {
  // An entry in no offered category (an event added by hand) starts out in the fallback, as an edit,
  // so Save applies what the dropdown shows (#92).
  const [form, setForm] = useState<FormState>(() => (fallbackCategory ? editField(openForm(initial), 'category', fallbackCategory) : openForm(initial)))
  const [seen, setSeen] = useState(initial)
  if (changedFields(seen, initial).length > 0) {
    setSeen(initial)
    setForm(followUntouched(form, initial))
  }
  const set = (field: EditableField) => (event: { target: { value: string } }) => setForm(current => editField(current, field, event.target.value))
  const gates = useFieldGates(initial, editing)
  const dates = useEntryDates(initialDates)
  const saved = {
    dates: dates.dates.map(entry => ({ ...entry, label: entry.label.trim() })),
    datesChanged: dates.touched,
    draft: { ...form.draft, title: form.draft.title.trim(), url: normaliseLink(form.draft.url) },
    latest: form.latest,
  }
  return { ...gates, dates, draft: form.draft, holdUpdates: holdUpdatesValue(form.touched.length > 0 || dates.touched), saved, set }
}

/** The fields that depend on what every person's app handles. */
const useFieldGates = (initial: ItemDraft, editing: boolean) => ({
  dateRequired: !useUndatedAllowed() && !(editing && initial.dueDate === ''),
  remindersShown: useRemindersAllowed() || initial.reminders !== '',
})
