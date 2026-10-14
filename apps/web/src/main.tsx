import './index.css'

/** Shown instead of the app where Temporal is missing (#179): the owner's wording. */
const NOTICE = "Safari doesn't support modern web standards as of 2026-10-11. Until temporal-polyfill is supported, this site is inaccessible."

// Stable Safari has no Temporal yet, and the app's code needs it from its first line on, so it is only
// loaded where Temporal exists; the household uses no iPhone (#179). Chromium and Firefox have it.
if ('Temporal' in globalThis) {
  await import('./start').catch(reportError)
} else {
  const notice = document.createElement('p')
  notice.className = 'm-6 max-w-md text-lg'
  notice.textContent = NOTICE
  document.querySelector('#root')?.append(notice)
}
