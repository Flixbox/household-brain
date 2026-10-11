import { EditForm } from '@household-brain/entries/components/items/EditForm'
import { useEntry } from '@household-brain/entries/lib/items/use-entry'
import { Link, useParams } from 'wouter'

export const EditItem = () => {
  const entry = useEntry(useParams<{ itemId: string }>().itemId)
  return (
    <section className="space-y-6">
      <div className="flex items-baseline justify-between">
        <h1 className="text-3xl font-bold">Edit entry</h1>
        <Link href="/" className="text-orange-700 underline dark:text-orange-400">Cancel</Link>
      </div>
      {entry.state === 'loading' && <p>Loading…</p>}
      {entry.state === 'gone' && <p>This entry no longer exists.</p>}
      {entry.state === 'ready' && <EditForm key={entry.item.id} item={entry.item} categories={entry.categories} />}
    </section>
  )
}
