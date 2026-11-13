import { hasText } from '@household-brain/core/lib/read'
import type { Pin } from './pins'

/** A GitHub REST read: the JSON object at `path`, or null when the request fails. */
export type GitHubRead = (path: string) => Promise<Record<string, unknown> | null>

export type Dated = { published: Temporal.Instant } | { error: string }

const text = (value: unknown): string | null => (typeof value === 'string' && value !== '' ? value : null)

const committedAt = (commit: unknown): string | null =>
  typeof commit === 'object' && commit !== null && 'committer' in commit && typeof commit.committer === 'object' && commit.committer !== null && 'date' in commit.committer
    ? text(commit.committer.date)
    : null

/** When the pin's tag was released, else when its commit was made. */
export const dateOf = async ({ action, repo, sha, tag }: Pin, github: GitHubRead): Promise<Dated> => {
  const release = hasText(tag) ? text((await github(`repos/${repo}/releases/tags/${tag}`))?.published_at) : null
  if (hasText(release)) {
    return { published: Temporal.Instant.from(release) }
  }
  const committed = committedAt((await github(`repos/${repo}/commits/${sha}`))?.commit)
  return hasText(committed) ? { published: Temporal.Instant.from(committed) } : { error: `Couldn't date ${action} ${tag ?? sha.slice(0, 7)}` }
}
