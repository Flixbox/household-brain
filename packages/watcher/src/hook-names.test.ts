/*
 * Every hook this repository registers has a name (#503). Neither host has a `name` field for a hook:
 * Codex 0.166's `/hooks` screen titles a handler with its `statusMessage` and shows "Unnamed hook"
 * without one, and Claude Code shows the same field as the spinner text while the hook runs.
 */
import { describe, expect, it } from 'bun:test'
import { isRecord, textOf } from './read'

const packagesRoot = `${import.meta.dir}/../..`
const manifestPaths = new Bun.Glob('*/{.claude-plugin,.codex-plugin,hooks}/{hooks,plugin}.json')

/** The events of a manifest: `hooks.hooks` in Codex's plugin.json, `hooks` in hooks.json or Claude's plugin.json. */
const eventsOf = (manifest: unknown): Record<string, unknown> => {
  const hooks = isRecord(manifest) ? manifest.hooks : null
  if (!isRecord(hooks)) {
    return {}
  }
  return isRecord(hooks.hooks) ? hooks.hooks : hooks
}

const asList = (value: unknown): unknown[] => (Array.isArray(value) ? value : [])

/** Each handler of a manifest, labelled so that a failure says which one has no name. */
const handlersIn = async (path: string) => {
  const manifest: unknown = JSON.parse(await Bun.file(`${packagesRoot}/${path}`).text())
  return Object.entries(eventsOf(manifest)).flatMap(([event, entries]) =>
    asList(entries)
      .flatMap(entry => (isRecord(entry) ? asList(entry.hooks) : []))
      .map(handler => ({ handler, label: `${path} ${event}` })),
  )
}

const registeredHandlers = async () => {
  const paths = await Array.fromAsync(manifestPaths.scan({ cwd: packagesRoot, dot: true }))
  return (await Promise.all(paths.map(async path => handlersIn(path)))).flat()
}

describe('the hooks this repository registers (#503)', () => {
  it('all have a name for the hosts to show', async () => {
    const handlers = await registeredHandlers()
    expect(handlers).not.toEqual([])
    const unnamed = handlers.filter(({ handler }) => !isRecord(handler) || textOf(handler.statusMessage).trim() === '')
    expect(unnamed.map(({ label }) => label)).toEqual([])
  })
})
