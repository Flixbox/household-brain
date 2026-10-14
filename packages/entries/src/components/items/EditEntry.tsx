import { useEntry } from '@household-brain/entries/lib/items/use-entry'
import { EditForm } from './EditForm'

/** The entry `itemId` in its edit form, once loaded; says so when it no longer exists. */
export const EditEntry = ({ itemId }: { itemId: string }) => {
  const entry = useEntry(itemId)
  if (entry.state === 'loading') {
    return <p>Loading…</p>
  }
  if (entry.state === 'gone') {
    return <p>This entry no longer exists.</p>
  }
  return <EditForm key={entry.item.id} item={entry.item} categories={entry.categories} />
}
