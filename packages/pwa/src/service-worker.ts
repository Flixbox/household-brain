/* oxlint-disable import/no-nodejs-modules -- a build step: runs on Bun at build time, never in the browser */
import { tmpdir } from 'node:os'
import path from 'node:path'
import { injectManifest } from '@serwist/build'
import type { PwaConfig } from '@household-brain/pwa/lib/config'

/**
 * Compiles the service worker (`sw.ts`, Serwist) with Bun and fills in the list of build files it
 * stores offline (`@serwist/build`). Returns how many files that is.
 */
export const writeServiceWorker = async (dir: string, config: PwaConfig) => {
  const compiled = await Bun.build({
    define: { NETWORK_ONLY: JSON.stringify(config.networkOnly) },
    entrypoints: [path.join(import.meta.dir, 'sw.ts')],
    format: 'iife',
    minify: true,
    target: 'browser',
  })
  const [output] = compiled.outputs
  if (!compiled.success || !output) {
    throw new AggregateError(compiled.logs, 'The service worker did not compile')
  }
  const source = path.join(tmpdir(), `household-brain-sw-${process.pid}.js`)
  await Bun.write(source, output)
  const { count, warnings } = await injectManifest({
    // The bundler's file names already carry a content hash, so they need no revision of their own.
    dontCacheBustURLsMatching: /^assets\//u,
    globDirectory: dir,
    // Only the install dialog shows the screenshots: not worth storing offline.
    globIgnores: ['screenshots/**'],
    globPatterns: ['**/*.{js,css,html,svg,png,ico,webmanifest}'],
    swDest: path.join(dir, 'sw.js'),
    swSrc: source,
  })
  if (warnings.length > 0) {
    throw new AggregateError(warnings, 'Storing the build offline failed')
  }
  return count
}
