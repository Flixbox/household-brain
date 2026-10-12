import { type ItemDraft, emptyDraft } from '@household-brain/entries/lib/items/model'
import { requestSyncAccess } from '@household-brain/entries/lib/items/outbox'
import { addItem } from '@household-brain/entries/lib/items/store'
import type { EntryDate } from '@household-brain/entries/lib/items/dates'
import { useCategories } from '@household-brain/entries/lib/items/use-items'
import { reportWriteFailure } from '@household-brain/entries/lib/items/write-failures'
import { useLocation } from 'wouter'
import { paths } from '@household-brain/entries/lib/paths'
import { ItemForm } from './ItemForm'
import { hasText } from '@household-brain/core/lib/read'

/** A new entry, starting in `category` when that is one of the household's categories. */
export const NewForm = ({ category }: { category: string | null }) => {
  const categories = useCategories()
  const [, navigate] = useLocation()
  const known = hasText(category) && categories.some(entry => entry.slug === category) ? category : ''
  const save = (draft: ItemDraft, { dates }: { dates: EntryDate[] }) => {
    // Order matters: ask Google first, inside the click; save without waiting for the server.
    requestSyncAccess()
    addItem(draft, dates).written.catch(reportWriteFailure)
    navigate(paths.home)
  }
  return categories.length > 0 ? <ItemForm initial={emptyDraft(known)} categories={categories} onSave={save} /> : null
}
