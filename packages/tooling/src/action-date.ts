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

/**
 * Why the pin's version comment can't date it, or null when its tag points at the pinned commit. The
 * comment is only text (#556): a fresh commit commented with an old release, or a script line
 * repeating the pin with another version, would otherwise borrow that release's date.
 */
const tagMismatch = async ({ action, repo, sha }: Pin, tag: string, github: GitHubRead): Promise<string | null> => {
  const tagged = text((await github(`repos/${repo}/commits/refs/tags/${tag}`))?.sha)?.toLowerCase()
  if (!hasText(tagged)) {
    return `${action} has no tag ${tag} for the pinned ${sha.slice(0, 7)}`
  }
  return tagged === sha ? null : `${action} ${tag} points at ${tagged.slice(0, 7)}, not at the pinned ${sha.slice(0, 7)}`
}

const later = (first: Temporal.Instant, second: Temporal.Instant): Temporal.Instant => (Temporal.Instant.compare(first, second) > 0 ? first : second)

/**
 * When the pin's tag was released or its commit was made, whichever is later: a release tag moved
 * onto a fresh commit keeps its old release date. A tag must point at the pinned commit.
 */
export const dateOf = async (pin: Pin, github: GitHubRead): Promise<Dated> => {
  const { action, repo, sha, tag } = pin
  const mismatch = hasText(tag) ? await tagMismatch(pin, tag, github) : null
  if (hasText(mismatch)) {
    return { error: mismatch }
  }
  const committed = committedAt((await github(`repos/${repo}/commits/${sha}`))?.commit)
  if (!hasText(committed)) {
    return { error: `Couldn't date ${action} ${tag ?? sha.slice(0, 7)}` }
  }
  const release = hasText(tag) ? text((await github(`repos/${repo}/releases/tags/${tag}`))?.published_at) : null
  const commitDate = Temporal.Instant.from(committed)
  return { published: hasText(release) ? later(Temporal.Instant.from(release), commitDate) : commitDate }
}
