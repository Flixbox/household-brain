import { dirname, join } from 'node:path'

/**
 * The app's description, written once in the repository's root package.json (the one that lists the
 * `workspaces`), found by walking up from where `pwa-build` runs.
 */
export const workspaceDescription = async (from = process.cwd()): Promise<string> => {
  const file = Bun.file(join(from, 'package.json'))
  const manifest: { description?: unknown, workspaces?: unknown } = await file.exists() ? await file.json() : {}
  if (manifest.workspaces) {
    if (typeof manifest.description !== 'string' || !manifest.description) {
      throw new Error(`${file.name} has no description`)
    }
    return manifest.description
  }
  if (dirname(from) === from) {
    throw new Error('No package.json with workspaces above the app')
  }
  return workspaceDescription(dirname(from))
}
