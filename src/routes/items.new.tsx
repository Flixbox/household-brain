import { Link, createFileRoute, useNavigate } from '@tanstack/react-router'
import { ItemForm } from '../components/items/ItemForm'
import { type ItemDraft, emptyDraft } from '../lib/items/model'
import { requestSyncAccess } from '../lib/items/outbox'
import { addItem } from '../lib/items/store'
import { useCategories } from '../lib/items/use-items'

export const Route = createFileRoute('/items/new')({
  component: NewItem,
  validateSearch: (search: Record<string, unknown>): { category?: string } =>
    (typeof search.category === 'string' ? { category: search.category } : {}),
})

function NewItem() {
  const { category } = Route.useSearch()
  const categories = useCategories()
  const navigate = useNavigate()
  const save = async (draft: ItemDraft) => {
    await requestSyncAccess()
    await addItem(draft)
    await navigate({ to: '/' })
  }
  return (
    <section className="space-y-6">
      <div className="flex items-baseline justify-between">
        <h1 className="text-3xl font-bold">New entry</h1>
        <Link to="/" className="text-orange-700 underline dark:text-orange-400">Cancel</Link>
      </div>
      {categories.length > 0 && <ItemForm initial={emptyDraft(category)} categories={categories} onSave={save} />}
    </section>
  )
}
