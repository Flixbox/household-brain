/**
 * Fails when a workflow pins a GitHub Action release younger than 48 hours (#102), as Bun's
 * minimumReleaseAge and check-package-age.ts do for packages (#94). Each
 * `uses: owner/repo@<sha> # vX.Y.Z` is dated by its release, or by its commit when the tag has no
 * release (or there is no version comment). Re-run it once the release is old enough.
 *
 *   bun packages/tooling/src/check-action-age.ts [min-hours=48]    from the repository root; GH_TOKEN reads public repos
 */
import { hasText, recordOf } from '@household-brain/core/lib/read'
import { Glob } from 'bun'
import { hoursSince, tooYoung } from './age'
import { pinnedActions } from './pins'

const [, , minHours = '48'] = process.argv
const MINIMUM_SECONDS = Number(minHours) * 60 * 60

const github = async (path: string): Promise<Record<string, unknown> | null> => {
  const response = await fetch(`https://api.github.com/${path}`, {
    headers: { Accept: 'application/vnd.github+json', ...hasText(process.env.GH_TOKEN) ? { Authorization: `Bearer ${process.env.GH_TOKEN}` } : {} },
  })
  return response.ok ? recordOf(await response.json()) : null
}

const text = (value: unknown): string | null => (typeof value === 'string' && value !== '' ? value : null)

/** When the tag was released, else when its commit was made. */
const releasedAt = async ({ repo, sha, tag }: { repo: string, sha: string, tag: string | null }): Promise<Temporal.Instant | null> => {
  const release = hasText(tag) ? text((await github(`repos/${repo}/releases/tags/${tag}`))?.published_at) : null
  if (hasText(release)) {
    return Temporal.Instant.from(release)
  }
  const commit = (await github(`repos/${repo}/commits/${sha}`))?.commit
  const committed = typeof commit === 'object' && commit !== null && 'committer' in commit && typeof commit.committer === 'object' && commit.committer !== null && 'date' in commit.committer
    ? text(commit.committer.date)
    : null
  return hasText(committed) ? Temporal.Instant.from(committed) : null
}

const workflows = await Promise.all(Array.from(new Glob('.github/workflows/*.{yml,yaml}').scanSync('.')).map(async path => Bun.file(path).text()))
const pins = pinnedActions(workflows.join('\n'))
// Every workflow pins its actions by commit: finding none means the scan itself broke.
if (pins.length === 0) {
  throw new Error('No pinned actions found in .github/workflows')
}

const results = await Promise.all(pins.map(async pin => ({ pin, published: await releasedAt(pin) })))
for (const { pin, published } of results) {
  const label = `${pin.action} ${pin.tag ?? pin.sha.slice(0, 7)}`
  if (!published) {
    process.stdout.write(`::error::Couldn't date ${label}\n`)
  } else if (tooYoung(published, MINIMUM_SECONDS)) {
    process.stdout.write(`::error::${label} is ${hoursSince(published)} h old (published ${published.toString()}); the minimum is ${minHours} h. Re-run once it is old enough.\n`)
  } else {
    process.stdout.write(`${label}: ${hoursSince(published)} h old\n`)
  }
}
if (results.some(({ published }) => !published || tooYoung(published, MINIMUM_SECONDS))) {
  process.exit(1)
}
