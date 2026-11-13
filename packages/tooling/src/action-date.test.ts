import { describe, expect, it } from 'bun:test'
import { type Fetch, type GitHubRead, dateOf, gitHubRest } from './action-date'
import { pinnedActions } from './pins'

const SHA = 'a'.repeat(40)
const OTHER = 'b'.repeat(40)
const OLD = '2026-01-01T00:00:00Z'
const FRESH = '2026-11-12T00:00:00Z'

/** A GitHub that answers only the paths it is given. */
const fake = (answers: Record<string, Record<string, unknown>>): GitHubRead => async path => answers[path] ?? null

const commit = (sha: string, date: string): Record<string, unknown> => ({ commit: { committer: { date } }, sha })

const pin = { action: 'actions/checkout', repo: 'actions/checkout', sha: SHA, tag: 'v7.0.1' }

describe('dateOf', () => {
  it('dates a pin by its release when the tag points at the pinned commit', async () => {
    const github = fake({
      'repos/actions/checkout/commits/refs/tags/v7.0.1': commit(SHA, OLD),
      'repos/actions/checkout/releases/tags/v7.0.1': { published_at: FRESH },
      [`repos/actions/checkout/commits/${SHA}`]: commit(SHA, OLD),
    })
    expect(await dateOf(pin, github)).toEqual({ published: Temporal.Instant.from(FRESH) })
  })

  // A release tag moved onto a fresh commit points at the pin but keeps its old release date (#565's review).
  it('dates a pin by its commit when that is younger than the release', async () => {
    const github = fake({
      'repos/actions/checkout/commits/refs/tags/v7.0.1': commit(SHA, FRESH),
      'repos/actions/checkout/releases/tags/v7.0.1': { published_at: OLD },
      [`repos/actions/checkout/commits/${SHA}`]: commit(SHA, FRESH),
    })
    expect(await dateOf(pin, github)).toEqual({ published: Temporal.Instant.from(FRESH) })
  })

  it('dates a pin without a version comment by its commit', async () => {
    const github = fake({ [`repos/actions/checkout/commits/${SHA}`]: commit(SHA, FRESH) })
    expect(await dateOf({ ...pin, tag: null }, github)).toEqual({ published: Temporal.Instant.from(FRESH) })
  })

  // A fresh commit commented with an old release passed the 48-hour check on that release's date (#556).
  it('refuses a tag that points at another commit', async () => {
    const github = fake({
      'repos/actions/checkout/commits/refs/tags/v7.0.1': commit(OTHER, OLD),
      'repos/actions/checkout/releases/tags/v7.0.1': { published_at: OLD },
      [`repos/actions/checkout/commits/${SHA}`]: commit(SHA, FRESH),
    })
    expect(await dateOf(pin, github)).toEqual({ error: `actions/checkout v7.0.1 points at ${OTHER.slice(0, 7)}, not at the pinned ${SHA.slice(0, 7)}` })
  })

  it('refuses a tag the repository does not have', async () => {
    const github = fake({ [`repos/actions/checkout/commits/${SHA}`]: commit(SHA, FRESH) })
    expect(await dateOf(pin, github)).toEqual({ error: `actions/checkout has no tag v7.0.1 for the pinned ${SHA.slice(0, 7)}` })
  })

  // A script line repeating the pin once gave it another version, here an old release (#555's clearing review, #567).
  it('dates a pin by its own entry, never by a version a script line gives it', async () => {
    const workflow = `steps:\n  - uses: actions/checkout@${SHA} # v7.0.1\n  - run: |\n      uses: actions/checkout@${SHA} # v1.0.0\n`
    const [entry] = pinnedActions(workflow)
    const github = fake({
      'repos/actions/checkout/commits/refs/tags/v1.0.0': commit(OTHER, OLD),
      'repos/actions/checkout/commits/refs/tags/v7.0.1': commit(SHA, FRESH),
      'repos/actions/checkout/releases/tags/v1.0.0': { published_at: OLD },
      [`repos/actions/checkout/commits/${SHA}`]: commit(SHA, FRESH),
    })
    expect(entry?.tag).toBe('v7.0.1')
    expect(await dateOf(entry ?? pin, github)).toEqual({ published: Temporal.Instant.from(FRESH) })
  })
})

/** A fetch that answers every request with `status` and `body`. */
const answering =
  (status: number, body: unknown = {}): Fetch =>
    async () =>
      Response.json(body, { status })

describe('gitHubRest', () => {
  it('reads the object GitHub answers with', async () => {
    expect(await gitHubRest(null, answering(200, { sha: SHA }))('repos/actions/checkout/commits/x')).toEqual({ sha: SHA })
  })

  it('reads a 404 as nothing there', async () => {
    expect(await gitHubRest(null, answering(404))('repos/actions/checkout/releases/tags/v7.0.1')).toBeNull()
  })

  // A 403 or rate limit read as "no release" dated a fresh release by its old commit (#568).
  it('fails on any other answer', async () => {
    await expect(gitHubRest(null, answering(403))('repos/actions/checkout/releases/tags/v7.0.1')).rejects.toThrow('403')
  })
})

describe('dateOf when a read fails', () => {
  // A failed release read passed as "no release", so the pin was dated by its commit alone (#568).
  it('refuses a pin whose release it could not read', async () => {
    const answers = fake({
      'repos/actions/checkout/commits/refs/tags/v7.0.1': commit(SHA, OLD),
      [`repos/actions/checkout/commits/${SHA}`]: commit(SHA, OLD),
    })
    const github: GitHubRead = async path => {
      if (path.includes('/releases/')) {
        throw new Error(`GitHub answered 403 for ${path}`)
      }
      return answers(path)
    }
    expect(await dateOf(pin, github)).toEqual({ error: "Couldn't read actions/checkout v7.0.1: GitHub answered 403 for repos/actions/checkout/releases/tags/v7.0.1" })
  })
})
