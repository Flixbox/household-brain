import { hasText, recordOf } from '@household-brain/core/lib/read'
import { stringify } from '@household-brain/core/lib/stringify'
import type { Pin } from './pins'

/**
 * A GitHub REST read: the JSON object at `path`, or null when nothing is there (a 404). Any other
 * failure throws, so a 403 or a rate limit isn't mistaken for "no release" (#568).
 */
export type GitHubRead = (path: string) => Promise<Record<string, unknown> | null>

/** The part of `fetch` a GitHub read uses, so a test can answer in its place. */
export type Fetch = (url: string, init: RequestInit) => Promise<Response>

/** A GitHub answer other than a success or a 404, with its status for a caller that expects one. */
class GitHubAnsweredError extends Error {
  public readonly status: number

  public constructor(status: number, path: string) {
    super(`GitHub answered ${status} for ${path}`)
    this.name = 'GitHubAnsweredError'
    this.status = status
  }
}

/** Reads GitHub's REST API, signed with `token` when there is one. */
export const gitHubRest =
  (token: string | null, fetchFrom: Fetch = fetch): GitHubRead =>
    async path => {
      const response = await fetchFrom(`https://api.github.com/${path}`, {
        headers: { Accept: 'application/vnd.github+json', ...hasText(token) ? { Authorization: `Bearer ${token}` } : {} },
      })
      if (response.status === 404) {
        return null
      }
      if (!response.ok) {
        throw new GitHubAnsweredError(response.status, path)
      }
      return recordOf(await response.json())
    }

export type Dated = { published: Temporal.Instant } | { error: string }

const text = (value: unknown): string | null => (typeof value === 'string' && value !== '' ? value : null)

const committedAt = (commit: unknown): string | null =>
  typeof commit === 'object' && commit !== null && 'committer' in commit && typeof commit.committer === 'object' && commit.committer !== null && 'date' in commit.committer
    ? text(commit.committer.date)
    : null

/**
 * The commit a tag points at, or null when the repository has no such tag: GitHub answers a missing
 * tag's commit read with 422, not 404 (#573). Every other failure still throws.
 */
const readTag = async (repo: string, tag: string, github: GitHubRead): Promise<Record<string, unknown> | null> => {
  try {
    return await github(`repos/${repo}/commits/refs/tags/${tag}`)
  } catch (error) {
    if (error instanceof GitHubAnsweredError && error.status === 422) {
      return null
    }
    throw error
  }
}

/**
 * Why the pin's version comment can't date it, or null when its tag points at the pinned commit. The
 * comment is only text (#556): a fresh commit commented with an old release, or a script line
 * repeating the pin with another version, would otherwise borrow that release's date.
 */
const tagMismatch = async ({ action, repo, sha }: Pin, tag: string, github: GitHubRead): Promise<string | null> => {
  const tagged = text((await readTag(repo, tag, github))?.sha)?.toLowerCase()
  if (!hasText(tagged)) {
    return `${action} has no tag ${tag} for the pinned ${sha.slice(0, 7)}`
  }
  return tagged === sha ? null : `${action} ${tag} points at ${tagged.slice(0, 7)}, not at the pinned ${sha.slice(0, 7)}`
}

const later = (first: Temporal.Instant, second: Temporal.Instant): Temporal.Instant => (Temporal.Instant.compare(first, second) > 0 ? first : second)

const datePin = async (pin: Pin, github: GitHubRead): Promise<Dated> => {
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

/**
 * When the pin's tag was released or its commit was made, whichever is later: a release tag moved
 * onto a fresh commit keeps its old release date. A tag must point at the pinned commit, and a read
 * that fails refuses the pin rather than dating it by what was read (#568).
 */
export const dateOf = async (pin: Pin, github: GitHubRead): Promise<Dated> => {
  try {
    return await datePin(pin, github)
  } catch (error) {
    return { error: `Couldn't read ${pin.action} ${pin.tag ?? pin.sha.slice(0, 7)}: ${stringify(error)}` }
  }
}
