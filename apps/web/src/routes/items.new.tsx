import { Link, createFileRoute, useNavigate } from '@tanstack/react-router'
import { type ItemDraft, ItemForm, addItem, emptyDraft, reportWriteFailure, requestSyncAccess, useCategories } from '@household-brain/calendar'

export const Route = createFileRoute('/items/new')({
  component: NewItem,
  validateSearch: (search: Record<string, unknown>): { category?: string } =>
    (typeof search.category === 'string' ? { category: search.category } : {}),
})

function NewItem() {
  const { category } = Route.useSearch()
  const categories = useCategories()
  const navigate = useNavigate()
  const known = categories.some(entry => entry.slug === category) ? category : ''
  const save = (draft: ItemDraft) => {
    // Order matters: ask Google first, inside the click; save without waiting for the server.
    requestSyncAccess()
    addItem(draft).written.catch(reportWriteFailure)
    return navigate({ to: '/' })
  }
  return (
    <section className="space-y-6">
      <div className="flex items-baseline justify-between">
        <h1 className="text-3xl font-bold">New entry</h1>
        <Link to="/" className="text-orange-700 underline dark:text-orange-400">Cancel</Link>
      </div>
      {categories.length > 0 && <ItemForm initial={emptyDraft(known)} categories={categories} onSave={save} />}
    </section>
  )
}
