import { useNavigate } from '@tanstack/react-router'
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
  const opened = draftOf(item)
  const after = (write: Promise<void>) => {
    write.catch(reportWriteFailure)
    return navigate({ to: '/' })
  }
  // Each handler asks Google first, inside the click, and saves without waiting for the server.
  const save = (draft: ItemDraft) => {
    requestSyncAccess()
    return after(editItem(item.id, opened, draft))
  }
  const remove = () => {
    requestSyncAccess()
    return after(removeItem(item.id))
  }
  return (
    <>
      <ItemForm initial={opened} categories={categories} onSave={save} />
      <button type="button" className="font-semibold text-red-700 dark:text-red-400" onClick={remove}>Delete entry</button>
    </>
  )
}
