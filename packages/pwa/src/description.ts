/* oxlint-disable import/no-nodejs-modules -- a build step: runs on Bun at build time, never in the browser */
import { recordOf } from '@household-brain/core/lib/read'
import path from 'node:path'

/**
 * The app's description, written once in the repository's root package.json (the one that lists the
 * `workspaces`), found by walking up from where `pwa-build` runs.
 */
export const workspaceDescription = async (from = process.cwd()): Promise<string> => {
  const file = Bun.file(path.join(from, 'package.json'))
  const manifest = recordOf(await file.exists() ? await file.json() : {})
  if ('workspaces' in manifest) {
    if (typeof manifest.description !== 'string' || !manifest.description) {
      throw new Error(`${file.name} has no description`)
    }
    return manifest.description
  }
  if (path.dirname(from) === from) {
    throw new Error('No package.json with workspaces above the app')
  }
  return workspaceDescription(path.dirname(from))
}
