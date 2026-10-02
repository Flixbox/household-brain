import { Link, createFileRoute } from '@tanstack/react-router'
import { EditForm } from '@household-brain/calendar/components/items/EditForm'
import { useEntry } from '@household-brain/calendar/lib/items/use-entry'

export const Route = createFileRoute('/items/$itemId')({
  component: EditItem,
})

function EditItem() {
  const entry = useEntry(Route.useParams().itemId)
  return (
    <section className="space-y-6">
      <div className="flex items-baseline justify-between">
        <h1 className="text-3xl font-bold">Edit entry</h1>
        <Link to="/" className="text-orange-700 underline dark:text-orange-400">Cancel</Link>
      </div>
      {entry.state === 'loading' && <p>Loading…</p>}
      {entry.state === 'gone' && <p>This entry no longer exists.</p>}
      {entry.state === 'ready' && <EditForm key={entry.item.id} item={entry.item} categories={entry.categories} />}
    </section>
  )
}
