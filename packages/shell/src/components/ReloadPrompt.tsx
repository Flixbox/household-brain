import { useEffect, useState } from 'react'
import { useRegisterSW } from 'virtual:pwa-register/react'

/** How often an open app asks the server for a new version. */
const CHECK_EVERY_MS = 60 * 60 * 1000

/** Asks for a new version now, and every hour and whenever the app comes back on screen. */
const watchForUpdates = (registration: ServiceWorkerRegistration) => {
  const check = () => {
    if (navigator.onLine) {
      registration.update().catch(() => null)
    }
  }
  const onVisibility = () => {
    if (document.visibilityState === 'visible') {
      check()
    }
  }
  setInterval(check, CHECK_EVERY_MS)
  document.addEventListener('visibilitychange', onVisibility)
}

/**
 * Keeps old versions of the app rare. A new version is installed as soon as it is found and
 * applied when the app leaves the screen (switching apps, locking the phone), so a phone that is
 * never closed doesn't run an old build for days. Not while something on the page carries
 * `data-hold-updates`: an edited form, or a Google window that is open on top of the app. Then
 * the next time the app leaves the screen. While the app is on screen, a toast offers to reload
 * right away; "Later" only hides the toast.
 */
export const ReloadPrompt = () => {
  const [dismissed, setDismissed] = useState(false)
  const { needRefresh: [needRefresh], updateServiceWorker } = useRegisterSW({
    onRegisteredSW: (_url, registration) => registration && watchForUpdates(registration),
  })
  useEffect(() => {
    if (!needRefresh) {
      return
    }
    const applyWhenHidden = () => {
      if (document.visibilityState === 'hidden' && !document.querySelector('[data-hold-updates]')) {
        updateServiceWorker(true).catch(() => null)
      }
    }
    applyWhenHidden()
    document.addEventListener('visibilitychange', applyWhenHidden)
    return () => document.removeEventListener('visibilitychange', applyWhenHidden)
  }, [needRefresh, updateServiceWorker])

  if (!needRefresh || dismissed) {
    return null
  }
  return (
    <div role="status" className="fixed inset-x-4 bottom-4 mx-auto flex max-w-md items-center gap-3 rounded-xl bg-stone-900 px-4 py-3 text-stone-50 shadow-lg">
      <span className="flex-1">A new version is available. It loads by itself when you leave the app.</span>
      <button type="button" className="font-semibold text-orange-300" onClick={() => updateServiceWorker(true)}>Reload</button>
      <button type="button" className="text-stone-400" onClick={() => setDismissed(true)}>Later</button>
    </div>
  )
}
