export interface Pin {
  /** `owner/repo` or `owner/repo/path` as written after `uses:`. */
  action: string
  /** The repository the action lives in: its first two path segments. */
  repo: string
  sha: string
  /** The version in the trailing comment (`# v1.2.3`), if any. */
  tag: string | null
}

const PINNED = /uses: (?<action>[^\s@]+)@(?<sha>[0-9a-f]{40})(?: # (?<tag>v\S+))?/gu

/** Every action a workflow pins by commit, once each. */
export const pinnedActions = (workflow: string): Pin[] => {
  const pins = new Map<string, Pin>()
  for (const { groups } of workflow.matchAll(PINNED)) {
    const action = groups?.action ?? ''
    const sha = groups?.sha ?? ''
    pins.set(`${action}@${sha}`, { action, repo: action.split('/').slice(0, 2).join('/'), sha, tag: groups?.tag ?? null })
  }
  return [...pins.values()]
}
