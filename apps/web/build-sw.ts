import { generateSW } from 'workbox-build'

/**
 * Writes the service worker that keeps the app working offline: `bun build-sw.ts <build dir>`, after
 * the build. It stores every file of the build, answers each page address with index.html, and
 * waits with a new version until the app asks for it (`ReloadPrompt`).
 */
const [dir] = process.argv.slice(2)
if (!dir) {
  throw new Error('Usage: bun build-sw.ts <build dir>')
}

const { count, warnings } = await generateSW({
  cleanupOutdatedCaches: true,
  // Vite's file names already carry a content hash, so they need no revision of their own.
  dontCacheBustURLsMatching: /^assets\//u,
  globDirectory: dir,
  // Only the install dialog shows the screenshots: not worth storing offline.
  globIgnores: ['screenshots/**'],
  globPatterns: ['**/*.{js,css,html,svg,png,ico,webmanifest}'],
  inlineWorkboxRuntime: true,
  navigateFallback: 'index.html',
  // Firebase Auth's sign-in handler must always come from the network.
  navigateFallbackDenylist: [/^\/__\//u],
  sourcemap: false,
  swDest: `${dir}/sw.js`,
})
for (const warning of warnings) {
  process.stderr.write(`${warning}\n`)
}
process.stdout.write(`sw.js stores ${count} files\n`)
