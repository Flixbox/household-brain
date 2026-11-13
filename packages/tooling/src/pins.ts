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
const USES_ENTRY = /^[ \t-]*["']?uses["']?[ \t]*:\s*(?:&\S+\s+)?(?<rest>\S.*)$/gmu
const VERSIONED = /^["']?(?<value>[^\s"'#]+)["']?[ \t]+#[ \t]*(?<tag>v\S+)/u

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
  new Map([...workflow.matchAll(USES_ENTRY)].flatMap(({ groups }) => {
    const entry = VERSIONED.exec(groups?.rest ?? '')?.groups
    return entry ? [[entry.value ?? '', entry.tag ?? ''] as const] : []
  }))

/**
 * Every action a workflow pins by commit, once each. Reads the workflow as YAML, so no spelling of
 * `uses` skips the age check (#554), and throws on one that isn't valid YAML. Throws too on a ref
 * that isn't a full commit SHA (a tag, branch, short SHA or Docker image), which the age check
 * couldn't date (#559); only a local `./` action or workflow needs no pin.
 */
export const pinnedActions = (workflow: string): Pin[] => {
  const pins = new Map<string, Pin>()
  const versions = versionsOf(workflow)
  const values = usesValues(Bun.YAML.parse(workflow)).filter(value => !value.startsWith('./'))
  const unpinned = values.filter(value => !PINNED.test(value))
  if (unpinned.length > 0) {
    throw new Error(`Actions not pinned to a full commit SHA: ${unpinned.join(', ')}`)
  }
  for (const value of values) {
    const groups = PINNED.exec(value)?.groups
    if (groups) {
      const action = groups.action ?? ''
      const sha = (groups.sha ?? '').toLowerCase()
      pins.set(`${action}@${sha}`, { action, repo: action.split('/').slice(0, 2).join('/'), sha, tag: versions.get(value) ?? null })
    }
  }
  return [...pins.values()]
}
