import { useNavigate } from '@tanstack/react-router'
import { useEffect, useMemo } from 'react'
import type { Category } from '../../lib/categories'
import { type Item, type ItemDraft, draftOf } from '../../lib/items/model'
import { refreshNow, requestSyncAccess } from '../../lib/items/outbox'
import { editItem, removeItem } from '../../lib/items/store'
import { reportWriteFailure } from '../../lib/items/write-failures'
import { ItemForm } from './ItemForm'

/** Edit and delete one entry. */
export function EditForm({ item, categories }: { item: Item, categories: Category[] }) {
  const navigate = useNavigate()
  // Fetch Google's latest now; when it arrives, the fields not edited yet follow it (ItemForm).
  useEffect(() => {
    refreshNow().catch(() => null)
  }, [])
  const current = useMemo(() => draftOf(item), [item])
  const after = (write: Promise<void>) => {
    write.catch(reportWriteFailure)
    return navigate({ to: '/' })
  }
  // Each handler asks Google first, inside the click, and saves without waiting for the server.
  // Saved: what differs from the newest version the form has seen, i.e. only fields typed in here
  // (untouched fields already equal it), so a change from Google never counts as one made here.
  const save = (draft: ItemDraft, latest: ItemDraft) => {
    requestSyncAccess()
    return after(editItem(item.id, latest, draft))
  }
  const remove = () => {
    requestSyncAccess()
    return after(removeItem(item.id))
  }
  return (
    <>
      <ItemForm initial={current} categories={categories} onSave={save} withStatus />
      <button type="button" className="font-semibold text-red-700 dark:text-red-400" onClick={remove}>Delete entry</button>
    </>
  )
}
