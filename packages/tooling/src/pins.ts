export interface Pin {
  /** `owner/repo` or `owner/repo/path` as written after `uses:`. */
  action: string
  /** The repository the action lives in: its first two path segments. */
  repo: string
  sha: string
  /** The version in the trailing comment (`# v1.2.3`), if any. */
  tag: string | null
}

const PINNED = /^(?<action>[^\s@]+)@(?<sha>[0-9a-fA-F]{40})$/u
const VERSION = /^["']?[ \t]+#[ \t]*(?<tag>v\S+)/u

/** Every `uses` value at any depth of a parsed workflow. */
const usesValues = (node: unknown): string[] => {
  if (Array.isArray(node)) {
    return node.flatMap(item => usesValues(item))
  }
  if (typeof node !== 'object' || node === null) {
    return []
  }
  return Object.entries(node).flatMap(([key, value]) => (key === 'uses' && typeof value === 'string' ? [value] : usesValues(value)))
}

/** The version commented behind a value, on its own line (#546). YAML drops comments, so this reads the text. */
const versionOf = (workflow: string, value: string): string | null => {
  const versions = workflow.split('\n').filter(line => !line.trimStart().startsWith('#')).flatMap(line => {
    const at = line.indexOf(value)
    const tag = at === -1 ? null : (VERSION.exec(line.slice(at + value.length))?.groups?.tag ?? null)
    return tag === null ? [] : [tag]
  })
  return versions.at(-1) ?? null
}

/**
 * Every action a workflow pins by commit, once each. Reads the workflow as YAML, so no spelling of
 * `uses` skips the age check (#554), and throws on one that isn't valid YAML.
 */
export const pinnedActions = (workflow: string): Pin[] => {
  const pins = new Map<string, Pin>()
  for (const value of usesValues(Bun.YAML.parse(workflow))) {
    const groups = PINNED.exec(value)?.groups
    if (groups) {
      const action = groups.action ?? ''
      const sha = (groups.sha ?? '').toLowerCase()
      pins.set(`${action}@${sha}`, { action, repo: action.split('/').slice(0, 2).join('/'), sha, tag: versionOf(workflow, value) })
    }
  }
  return [...pins.values()]
}
