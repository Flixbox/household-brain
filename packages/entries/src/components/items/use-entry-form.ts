import { useEffect, useState } from 'react'
import { useForm, useSelector } from '@tanstack/react-form'
import type { EntryDate } from '@household-brain/entries/lib/items/dates'
import { holdUpdatesValue } from '@household-brain/entries/lib/update-hold'
import { useEntryDates } from './use-entry-dates'
import { normaliseLink } from '@household-brain/entries/lib/items/link'
import { useRemindersAllowed, useUndatedAllowed } from '@household-brain/entries/lib/items/use-undated'
import { EDITABLE_FIELDS, changedFields } from '@household-brain/entries/lib/items/model'
import { type ItemDraft, draftSchema } from '@household-brain/entries/lib/items/draft'
import { type Category, offeredCategory } from '@household-brain/entries/lib/categories'

/** What Save hands on: the draft, the newest version the form has seen, and the extra dates. */
export interface Saved {
  draft: ItemDraft
  latest: ItemDraft
  dates: EntryDate[]
  datesChanged: boolean
}

/**
 * The form (TanStack Form, #195), checked at Save against the entry schema (`draft.ts`), whose
 * messages show next to their fields. When `initial` changes by value (a newer version arrived, e.g.
 * from Google), every field nobody has changed here follows it, without counting as changed; a field
 * typed in stays, also when typed back to the old value (TanStack's `isDirty` stays set).
 * `dateRequired`: the due date may be left empty only once every app handles that, and an entry being
 * edited that already has none may stay so.
 * `remindersShown`: the entry's own reminders are offered once every app handles them, and always
 * for an entry that already has some.
 * `dates`: the extra dates (`useEntryDates`). `holdUpdates`: whether a new app version must wait, once
 * anything was edited. Save sends the title and date labels trimmed, a bare domain as a full address,
 * and the category the household offers for the stored one (the one the form shows).
 */
export const useEntryForm = (initial: ItemDraft, { categories, editing, initialDates, onSave }: { categories: Category[], editing: boolean, initialDates: EntryDate[], onSave: (saved: Saved) => void }) => {
  // The newest version seen, adjusted during render as React recommends; the form follows it below.
  const [latest, setLatest] = useState(initial)
  if (changedFields(latest, initial).length > 0) {
    setLatest(initial)
  }
  const dates = useEntryDates(initialDates)
  const form = useForm({
    defaultValues: initial,
    onSubmit: ({ value }) => {
      onSave({
        dates: dates.dates.map(entry => ({ ...entry, label: entry.label.trim() })),
        datesChanged: dates.touched,
        draft: { ...value, category: offeredCategory(value.category, categories), title: value.title.trim(), url: normaliseLink(value.url) },
        latest,
      })
    },
    validators: { onSubmit: draftSchema },
  })
  useEffect(() => {
    for (const field of EDITABLE_FIELDS) {
      if (form.getFieldMeta(field)?.isDirty !== true) {
        form.setFieldValue(field, latest[field], { dontUpdateMeta: true, dontValidate: true })
      }
    }
  }, [form, latest])
  const edited = useSelector(form.store, state => state.isDirty)
  return { ...useFieldGates(initial, editing), dates, form, holdUpdates: holdUpdatesValue(edited || dates.touched) }
}

/** The fields that depend on what every person's app handles. */
const useFieldGates = (initial: ItemDraft, editing: boolean) => ({
  dateRequired: !useUndatedAllowed() && !(editing && initial.dueDate === ''),
  remindersShown: useRemindersAllowed() || initial.reminders !== '',
})
