import { describe, expect, it } from 'bun:test'
import { dateOf, type GitHubRead } from './action-date'
import { pinnedActions } from './pins'

const SHA = 'a'.repeat(40)
const OTHER = 'b'.repeat(40)
const OLD = '2026-01-01T00:00:00Z'
const FRESH = '2026-11-12T00:00:00Z'

/** A GitHub that answers only the paths it is given. */
const fake = (answers: Record<string, Record<string, unknown>>): GitHubRead => async path => answers[path] ?? null

const commit = (sha: string, date: string): Record<string, unknown> => ({ sha, commit: { committer: { date } } })

const pin = { action: 'actions/checkout', repo: 'actions/checkout', sha: SHA, tag: 'v7.0.1' }

describe('dateOf', () => {
  it('dates a pin by its release when the tag points at the pinned commit', async () => {
    const github = fake({
      'repos/actions/checkout/commits/refs/tags/v7.0.1': commit(SHA, FRESH),
      'repos/actions/checkout/releases/tags/v7.0.1': { published_at: OLD },
      [`repos/actions/checkout/commits/${SHA}`]: commit(SHA, FRESH),
    })
    expect(await dateOf(pin, github)).toEqual({ published: Temporal.Instant.from(OLD) })
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

  // The version comment is read from the text, so a script line repeating the pin can set it (#555's clearing review).
  it('refuses a version a script line gave the pin', async () => {
    const workflow = `steps:\n  - uses: actions/checkout@${SHA} # v7.0.1\n  - run: |\n      uses: actions/checkout@${SHA} # v1.0.0\n`
    const [scripted] = pinnedActions(workflow)
    const github = fake({
      'repos/actions/checkout/commits/refs/tags/v7.0.1': commit(SHA, FRESH),
      'repos/actions/checkout/commits/refs/tags/v1.0.0': commit(OTHER, OLD),
      'repos/actions/checkout/releases/tags/v1.0.0': { published_at: OLD },
      [`repos/actions/checkout/commits/${SHA}`]: commit(SHA, FRESH),
    })
    expect(scripted).toBeDefined()
    expect(await dateOf(scripted ?? pin, github)).toHaveProperty('error')
  })
})
