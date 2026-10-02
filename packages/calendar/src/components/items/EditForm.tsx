import { useNavigate } from '@tanstack/react-router'
import { useRef } from 'react'
import type { Category } from '../../lib/categories'
import { EDITABLE_FIELDS, type Item, type ItemDraft } from '../../lib/items/model'
import { requestSyncAccess } from '../../lib/items/outbox'
import { editItem, removeItem } from '../../lib/items/store'
import { reportWriteFailure } from '../../lib/items/write-failures'
import { ItemForm } from './ItemForm'

const draftOf = (item: Item) => Object.fromEntries(EDITABLE_FIELDS.map(field => [field, item[field]])) as ItemDraft

/** Edit and delete one entry. */
export function EditForm({ item, categories }: { item: Item, categories: Category[] }) {
  const navigate = useNavigate()
  // What the form opened with, frozen: a change arriving from Google while editing must not count
  // as an edit made here.
  const opened = useRef(draftOf(item))
  const after = (write: Promise<void>) => {
    write.catch(reportWriteFailure)
    return navigate({ to: '/' })
  }
  // Each handler asks Google first, inside the click, and saves without waiting for the server.
  const save = (draft: ItemDraft) => {
    requestSyncAccess()
    return after(editItem(item.id, opened.current, draft))
  }
  const remove = () => {
    requestSyncAccess()
    return after(removeItem(item.id))
  }
  return (
    <>
      {/* ItemForm keeps its first `initial`, so later values of the live entry don't reset it. */}
      <ItemForm initial={draftOf(item)} categories={categories} onSave={save} />
      <button type="button" className="font-semibold text-red-700 dark:text-red-400" onClick={remove}>Delete entry</button>
    </>
  )
}
