#!/usr/bin/env bun
/* oxlint-disable import/no-nodejs-modules -- a build step: runs on Bun at build time, never in the browser */
/* oxlint-disable typescript/no-unsafe-assignment -- the app's config module is imported by path, so untyped here; pwa.config.ts types it as PwaConfig */
/**
 * Turns a finished web build into an installable app that works offline: `pwa-build <build dir>`,
 * run in the app's folder after the bundler, which reads the app's `pwa.config.ts`.
 */
import path from 'node:path'
import type { PwaConfig } from '@household-brain/pwa/lib/config'
import { writeAssets } from './assets'
import { workspaceDescription } from './description'
import { writeServiceWorker } from './service-worker'
import { hasText } from '@household-brain/core/lib/read'

const [dir] = process.argv.slice(2)
if (!hasText(dir)) {
  process.stderr.write('Usage: pwa-build <build dir>\n')
  process.exit(64)
}
const { default: config }: { default: PwaConfig } = await import(path.resolve('pwa.config.ts'))
await writeAssets(dir, config, await workspaceDescription())
const stored = await writeServiceWorker(dir, config)
process.stdout.write(`${dir}: icons, manifest and a service worker that stores ${stored} files\n`)
