import { useStore } from '@nanostores/react'
import { $lastDone, undoDone } from '@household-brain/calendar/lib/items/swipe'

/** "Marked … done" after a swipe, with Undo, for a few seconds. */
export const DoneToast = () => {
  const last = useStore($lastDone)
  if (!last) {
    return null
  }
  return (
    <div role="status" className="fixed inset-x-4 bottom-4 z-10 mx-auto flex max-w-md items-center gap-3 rounded-lg bg-stone-900 px-4 py-3 text-sm text-white shadow-lg dark:bg-stone-100 dark:text-stone-900">
      <p className="flex-1">Marked “{last.item.title}” done.</p>
      <button type="button" onClick={undoDone} className="font-semibold text-orange-400 dark:text-orange-700">Undo</button>
    </div>
  )
}
