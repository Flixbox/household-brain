/* oxlint-disable typescript/no-unsafe-assignment, typescript/no-unsafe-call, typescript/no-unsafe-member-access -- the type-aware lint reads tsconfig.json, which leaves the worker out; tsc checks it through tsconfig.sw.json */
/* oxlint-disable eslint/no-underscore-dangle -- `__SW_MANIFEST` is Serwist's fixed name for the precache list */
import { type PrecacheEntry, Serwist, type SerwistGlobalConfig } from 'serwist'

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    // Filled in with the build's files by `@serwist/build` (service-worker.ts).
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined
  }
}
declare const self: ServiceWorkerGlobalScope
// The app's network-only page addresses, written in when the worker is compiled (service-worker.ts).
declare const NETWORK_ONLY: string[]

// Serves the stored build, answers every page address with index.html, and lets a new version
// take over only when the page asks for it (`applyUpdate`).
const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST ?? [],
  precacheOptions: {
    cleanupOutdatedCaches: true,
    navigateFallback: 'index.html',
    navigateFallbackDenylist: NETWORK_ONLY.map(source => new RegExp(source, 'u')),
  },
})
serwist.addEventListeners()

// Devices that installed the app before #148 still hold the Workbox caches of vite-plugin-pwa,
// which Serwist doesn't know to clean up.
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(names => Promise.all(names.filter(name => name.startsWith('workbox-')).map(name => caches.delete(name)))))
})
