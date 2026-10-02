import { useRegisterSW } from 'virtual:pwa-register/react'

/** Offers a reload when a new version has been deployed. */
export function ReloadPrompt() {
  const { needRefresh: [needRefresh, setNeedRefresh], updateServiceWorker } = useRegisterSW()

  if (!needRefresh) {
    return null
  }
  return (
    <div role="status" className="fixed inset-x-4 bottom-4 mx-auto flex max-w-md items-center gap-3 rounded-xl bg-stone-900 px-4 py-3 text-stone-50 shadow-lg">
      <span className="flex-1">A new version is available.</span>
      <button type="button" className="font-semibold text-orange-300" onClick={() => updateServiceWorker(true)}>Reload</button>
      <button type="button" className="text-stone-400" onClick={() => setNeedRefresh(false)}>Later</button>
    </div>
  )
}
