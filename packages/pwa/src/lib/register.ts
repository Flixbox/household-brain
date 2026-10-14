import { atom } from 'nanostores'
import { Serwist } from '@serwist/window'
import { ignoreFailure } from '@household-brain/core/lib/ignore'

/** How often an open app asks the server for a new version. */
const CHECK_EVERY_MS = 60 * 60 * 1000

/** Whether a new version of the app is installed and waits until the app lets it take over. */
export const $updateWaiting = atom(false)

/** The production build's service worker (`pwa-build`); the dev server has none. */
const serwist = process.env.NODE_ENV === 'production' && 'serviceWorker' in navigator ? new Serwist('/sw.js') : null
let started = false
let reloadWhenTakenOver = false

/** Asks for a new version now, and every hour and whenever the app comes back on screen. */
const watchForUpdates = (registration: ServiceWorkerRegistration) => {
  const check = () => {
    if (navigator.onLine) {
      // Offline or a server hiccup: the next check asks again.
      registration.update().catch(ignoreFailure)
    }
  }
  setInterval(check, CHECK_EVERY_MS)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      check()
    }
  })
}

/** Registers the service worker, only once per page however often it is called. */
export const startServiceWorker = () => {
  if (serwist === null || started) {
    return
  }
  started = true
  serwist.addEventListener('waiting', () => { $updateWaiting.set(true) })
  serwist.addEventListener('controlling', () => {
    if (reloadWhenTakenOver) {
      globalThis.location.reload()
    }
  })
  serwist.register().then(registration => {
    if (registration) {
      watchForUpdates(registration)
    }
  }).catch((error: unknown) => {
    // Offline, registering can fail as a matter of course, and the next start registers again. Online,
    // a failure means the app silently stops working offline, so it shows.
    if (navigator.onLine) {
      reportError(error)
    }
  })
}

/** Lets the waiting version take over, then reloads the page into it. */
export const applyUpdate = () => {
  reloadWhenTakenOver = true
  if (serwist !== null) {
    serwist.messageSkipWaiting()
  }
}
