import { useNavigate } from '@tanstack/react-router'
import { useEffect } from 'react'
import type { Category } from '@household-brain/entries/lib/categories'
import { type Item, type ItemDraft, draftOf } from '@household-brain/entries/lib/items/model'
import { refreshNow, requestSyncAccess } from '@household-brain/entries/lib/items/outbox'
import { editItem, removeItem, setExtraDates } from '@household-brain/entries/lib/items/store'
import { type EntryDate, sameDates } from '@household-brain/entries/lib/items/dates'
import { reportWriteFailure } from '@household-brain/entries/lib/items/write-failures'
import { ItemForm } from './ItemForm'

/** Edit and delete one entry. */
export const EditForm = ({ item, categories }: { item: Item, categories: Category[] }) => {
  const navigate = useNavigate()
  // Fetch Google's latest now; when it arrives, the fields not edited yet follow it (ItemForm).
  useEffect(() => {
    refreshNow().catch(() => null)
  }, [])
  const current = draftOf(item)
  const after = (write: Promise<unknown>) => {
    write.catch(reportWriteFailure)
    return navigate({ to: '/' })
  }
  // Each handler asks Google first, inside the click, and saves without waiting for the server.
  // Saved: what differs from the newest version the form has seen, i.e. only fields typed in here
  // (untouched fields already equal it), so a change from Google never counts as one made here.
  const save = (draft: ItemDraft, { latest, dates, datesChanged }: { latest: ItemDraft, dates: EntryDate[], datesChanged: boolean }) => {
    requestSyncAccess()
    // Only dates changed here are written: an untouched list may be older than what's stored.
    const datesSaved = datesChanged && !sameDates(item.extraDates, dates) ? setExtraDates(item.id, dates) : Promise.resolve()
    return after(Promise.all([editItem(item.id, latest, draft), datesSaved]))
  }
  const remove = () => {
    requestSyncAccess()
    return after(removeItem(item))
  }
  return (
    <>
      <ItemForm initial={current} initialDates={item.extraDates ?? []} categories={categories} onSave={save} withStatus />
      <button type="button" className="font-semibold text-red-700 dark:text-red-400" onClick={remove}>Delete entry</button>
    </>
  )
}
