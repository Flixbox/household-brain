import { EditEntry } from '@household-brain/entries/components/items/EditEntry'
import { Link, useParams } from 'wouter'
import { paths } from '@household-brain/entries/lib/paths'

export const EditItem = () => {
  const { itemId } = useParams<typeof paths.editItem>()
  return (
    <section className="space-y-6">
      <div className="flex items-baseline justify-between">
        <h1 className="text-3xl font-bold">Edit entry</h1>
        <Link href={paths.home} className="text-orange-700 underline dark:text-orange-400">Cancel</Link>
      </div>
      <EditEntry itemId={itemId} />
    </section>
  )
}
