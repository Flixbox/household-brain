/**
 * Fails when a workflow pins a GitHub Action release younger than 48 hours (#102), as Bun's
 * minimumReleaseAge and check-package-age.ts do for packages (#94). Each
 * `uses: owner/repo@<sha> # vX.Y.Z` is dated by its release or its commit, whichever is later, and
 * fails when the tag doesn't point at that commit (#556). Re-run it once the release is old enough.
 *
 *   bun packages/tooling/src/check-action-age.ts [min-hours=48]    from the repository root; GH_TOKEN reads public repos
 */
import { Glob } from 'bun'
import { hoursSince, tooYoung } from './age'
import { dateOf, gitHubRest } from './action-date'
import { pinnedActions } from './pins'

const [minHours = '48'] = process.argv.slice(2)
const MINIMUM_SECONDS = Number(minHours) * 60 * 60

const github = gitHubRest(process.env.GH_TOKEN ?? null)

const workflows = await Promise.all([...new Glob('.github/workflows/*.{yml,yaml}').scanSync('.')].map(async path => Bun.file(path).text()))
// One YAML document per file: joined plainly, their top-level keys would collide.
const pins = pinnedActions(workflows.join('\n---\n'))
// Every workflow pins its actions by commit: finding none means the scan itself broke.
if (pins.length === 0) {
  throw new Error('No pinned actions found in .github/workflows')
}

const results = await Promise.all(pins.map(async pin => ({ dated: await dateOf(pin, github), pin })))
for (const { dated, pin } of results) {
  const label = `${pin.action} ${pin.tag ?? pin.sha.slice(0, 7)}`
  if ('error' in dated) {
    process.stdout.write(`::error::${dated.error}\n`)
  } else if (tooYoung(dated.published, MINIMUM_SECONDS)) {
    process.stdout.write(`::error::${label} is ${hoursSince(dated.published)} h old (published ${dated.published.toString()}); the minimum is ${minHours} h. Re-run once it is old enough.\n`)
  } else {
    process.stdout.write(`${label}: ${hoursSince(dated.published)} h old\n`)
  }
}
if (results.some(({ dated }) => 'error' in dated || tooYoung(dated.published, MINIMUM_SECONDS))) {
  process.exit(1)
}
