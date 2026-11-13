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
// A line that looks like a `uses` entry and its version comment. YAML drops comments, so this reads the text (#546); never a line a comment or another key holds.
const USES_ENTRY = /^[ \t-]*["']?uses["']?[ \t]*:\s*(?:&\S+\s+)?(?<rest>\S.*)$/dgmu
const VERSIONED = /^["']?(?<value>[^\s"'#]+)["']?[ \t]+#[ \t]*(?<tag>v\S+)/du
// Stands in for a value to test whether YAML reads it as a `uses` entry.
const PROBE = 'uses-entry-probe'

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

/** Whether YAML reads the value at `start` as a `uses` entry, not as part of a script or another string (#567). */
const isUsesEntry = (workflow: string, start: number, value: string): boolean =>
  usesValues(Bun.YAML.parse(`${workflow.slice(0, start)}${PROBE}${workflow.slice(start + value.length)}`)).includes(PROBE)

/** The commented version of each `uses` entry. */
const versionsOf = (workflow: string): Map<string, string> =>
  new Map([...workflow.matchAll(USES_ENTRY)].flatMap(match => {
    const entry = VERSIONED.exec(match.groups?.rest ?? '')
    const value = entry?.groups?.value ?? ''
    const start = (match.indices?.groups?.rest?.[0] ?? 0) + (entry?.indices?.groups?.value?.[0] ?? 0)
    return entry && isUsesEntry(workflow, start, value) ? [[value, entry.groups?.tag ?? ''] as const] : []
  }))

/**
 * Every `uses` value but a local `./` action or workflow, which needs no pin. Throws on one that isn't
 * a full commit SHA (a tag, branch, short SHA or Docker image): the age check couldn't date it (#559).
 */
const pinnedValues = (workflow: unknown): string[] => {
  const values = usesValues(workflow).filter(value => !value.startsWith('./'))
  const unpinned = values.filter(value => !PINNED.test(value))
  if (unpinned.length > 0) {
    throw new Error(`Actions not pinned to a full commit SHA: ${unpinned.join(', ')}`)
  }
  return values
}

/**
 * Every action a workflow pins by commit, once each. Reads the workflow as YAML, so no spelling of
 * `uses` skips the age check (#554), and throws on one that isn't valid YAML or isn't pinned (#559).
 */
export const pinnedActions = (workflow: string): Pin[] => {
  const pins = new Map<string, Pin>()
  const versions = versionsOf(workflow)
  for (const value of pinnedValues(Bun.YAML.parse(workflow))) {
    const groups = PINNED.exec(value)?.groups
    if (groups) {
      const action = groups.action ?? ''
      const sha = (groups.sha ?? '').toLowerCase()
      pins.set(`${action}@${sha}`, { action, repo: action.split('/').slice(0, 2).join('/'), sha, tag: versions.get(value) ?? null })
    }
  }
  return [...pins.values()]
}
