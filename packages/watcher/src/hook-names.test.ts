/*
 * Every hook this repository registers has a name (#503). Neither host has a `name` field for a hook:
 * Codex 0.166's `/hooks` screen titles a handler with its `statusMessage` and shows "Unnamed hook"
 * without one, and Claude Code shows the same field as the spinner text while the hook runs.
 */
import { describe, expect, it } from 'bun:test'
import { isRecord, textOf } from './read'

const packagesRoot = `${import.meta.dir}/../..`
const manifestPaths = new Bun.Glob('*/{.claude-plugin,.codex-plugin,hooks}/{hooks,plugin}.json')

/** The manifests known to register hooks: a scan that misses one of them has lost its hooks unnoticed (#505). */
const knownManifests = ['watcher/.codex-plugin/plugin.json', 'watcher/hooks/hooks.json']

/** The events of a manifest: `hooks.hooks` in Codex's plugin.json, `hooks` in hooks.json or Claude's plugin.json. */
const eventsOf = (manifest: unknown): Record<string, unknown> => {
  const hooks = isRecord(manifest) ? manifest.hooks : null
  if (!isRecord(hooks)) {
    return {}
  }
  return isRecord(hooks.hooks) ? hooks.hooks : hooks
}

const asList = (value: unknown): unknown[] => (Array.isArray(value) ? value : [])

const readJson = async (path: string): Promise<unknown> => JSON.parse(await Bun.file(`${packagesRoot}/${path}`).text())

/** The hook files a manifest points to: its `hooks` can be a path, or a list of them, from the plugin's folder. */
const referencedFiles = (path: string, manifest: unknown) => {
  const [plugin] = path.split('/')
  return [isRecord(manifest) ? manifest.hooks : null]
    .flat()
    .filter(reference => typeof reference === 'string')
    .map(reference => `${plugin}/${reference}`)
}

/** Each handler written in a manifest, labelled so that a failure says which one has no name. */
const handlersWritten = (path: string, manifest: unknown) =>
  Object.entries(eventsOf(manifest)).flatMap(([event, entries]) =>
    asList(entries)
      .flatMap(entry => (isRecord(entry) ? asList(entry.hooks) : []))
      .map(handler => ({ handler, label: `${path} ${event}`, path })),
  )

const handlersIn = async (path: string) => {
  const manifest = await readJson(path)
  const referenced = await Promise.all(
    referencedFiles(path, manifest).map(async file => handlersWritten(file, await readJson(file))),
  )
  return [...handlersWritten(path, manifest), ...referenced.flat()]
}

const registeredHandlers = async () => {
  const paths = await Array.fromAsync(manifestPaths.scan({ cwd: packagesRoot, dot: true }))
  return (await Promise.all(paths.map(async path => handlersIn(path)))).flat()
}

describe('the hooks this repository registers (#503)', () => {
  it('all have a name for the hosts to show', async () => {
    const handlers = await registeredHandlers()
    const scanned = new Set(handlers.map(({ path }) => path))
    expect(knownManifests.filter(path => !scanned.has(path))).toEqual([])
    const unnamed = handlers.filter(({ handler }) => !isRecord(handler) || textOf(handler.statusMessage).trim() === '')
    expect(unnamed.map(({ label }) => label)).toEqual([])
  })
})
