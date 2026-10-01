import { Link, createFileRoute, useNavigate } from '@tanstack/react-router'
import { ItemForm } from '../components/items/ItemForm'
import { EDITABLE_FIELDS, type ItemDraft } from '../lib/items/model'
import { requestSyncAccess } from '../lib/items/outbox'
import { editItem, removeItem } from '../lib/items/store'
import { useCategories, useItems } from '../lib/items/use-items'

export const Route = createFileRoute('/items/$itemId')({
  component: EditItem,
})

function EditItem() {
  const { itemId } = Route.useParams()
  const item = useItems()?.find(entry => entry.id === itemId)
  const categories = useCategories()
  const navigate = useNavigate()
  if (!item || categories.length === 0) {
    return <p>Loading…</p>
  }
  const initial = Object.fromEntries(EDITABLE_FIELDS.map(field => [field, item[field]])) as ItemDraft
  const save = async (draft: ItemDraft) => {
    await requestSyncAccess()
    await editItem(item, draft)
    await navigate({ to: '/' })
  }
  const remove = async () => {
    await requestSyncAccess()
    await removeItem(item)
    await navigate({ to: '/' })
  }
  return (
    <section className="space-y-6">
      <div className="flex items-baseline justify-between">
        <h1 className="text-3xl font-bold">Edit entry</h1>
        <Link to="/" className="text-orange-700 underline dark:text-orange-400">Cancel</Link>
      </div>
      <ItemForm initial={initial} categories={categories} onSave={save} />
      <button type="button" className="font-semibold text-red-700 dark:text-red-400" onClick={remove}>Delete entry</button>
    </section>
  )
}
