export interface Pin {
  /** `owner/repo` or `owner/repo/path` as written after `uses:`. */
  action: string
  /** The repository the action lives in: its first two path segments. */
  repo: string
  sha: string
  /** The version in the trailing comment (`# v1.2.3`), if any. */
  tag: string | null
}

const PINNED = /^(?<action>[^\s@]+)@(?<sha>[0-9a-f]{40})$/iu
// A `uses` entry and its version comment. YAML drops comments, so this reads the text (#546); never a line a comment or another key holds.
const COMMENTED = /^[ \t-]*["']?uses["']?[ \t]*:\s*(?:&\S+\s+)?["']?(?<value>[^\s"'#]+)["']?[ \t]+#[ \t]*(?<tag>v\S+)/gmu

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

/** The commented version of each `uses` value. */
const versionsOf = (workflow: string): Map<string, string> =>
  new Map([...workflow.matchAll(COMMENTED)].map(({ groups }) => [groups?.value ?? '', groups?.tag ?? ''] as const))

/**
 * Every action a workflow pins by commit, once each. Reads the workflow as YAML, so no spelling of
 * `uses` skips the age check (#554), and throws on one that isn't valid YAML.
 */
export const pinnedActions = (workflow: string): Pin[] => {
  const pins = new Map<string, Pin>()
  const versions = versionsOf(workflow)
  for (const value of usesValues(Bun.YAML.parse(workflow))) {
    const groups = PINNED.exec(value)?.groups
    if (groups) {
      const action = groups.action ?? ''
      const sha = (groups.sha ?? '').toLowerCase()
      pins.set(`${action}@${sha}`, { action, repo: action.split('/').slice(0, 2).join('/'), sha, tag: versions.get(value) ?? null })
    }
  }
  return [...pins.values()]
}
