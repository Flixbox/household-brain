/**
 * The 48-hour rule (#94) for the lockfile. Bun's `install.minimumReleaseAge` only applies when Bun
 * resolves a version (`bun add`, `bun update`); a version already written into bun.lock is installed
 * as it is, also with --frozen-lockfile (#140). So CI asks the npm registry when each version this
 * change adds to bun.lock was published, and fails on one younger than the setting.
 *
 *   bun packages/tooling/src/check-package-age.ts <base-ref>    compares bun.lock with the one at <base-ref>
 *
 * Run from the repository root (it reads bun.lock and bunfig.toml there).
 */
import { recordOf, textMapOf, textOf } from '@household-brain/core/lib/read'
import { $ } from 'bun'
import { tooYoung } from './age'

const REGISTRY = 'https://registry.npmjs.org'

interface Lockfile {
  packages: Record<string, [string, ...unknown[]]>
}

const isLockfile = (value: unknown): value is Lockfile =>
  typeof value === 'object' && value !== null && 'packages' in value && typeof value.packages === 'object'

/** `name@version` of every registry package in a lockfile; workspace packages left out. */
const lockedVersions = (text: string): Set<string> => {
  const lock: unknown = Bun.JSONC.parse(text)
  if (!isLockfile(lock)) {
    throw new TypeError('bun.lock has no packages')
  }
  return new Set(Object.values(lock.packages).map(([spec]) => spec).filter(spec => !spec.includes('@workspace:')))
}

const nameAndVersion = (spec: string): [string, string] => {
  const at = spec.lastIndexOf('@')
  return [spec.slice(0, at), spec.slice(at + 1)]
}

/** When the registry says this version was published; null when it doesn't say. */
const publishedAt = async (spec: string): Promise<Temporal.Instant | null> => {
  const [name, version] = nameAndVersion(spec)
  const response = await fetch(`${REGISTRY}/${name.replace('/', '%2F')}`)
  if (!response.ok) {
    throw new Error(`${REGISTRY} answered ${response.status} for ${name}`)
  }
  const published = textOf(textMapOf(recordOf(await response.json()).time)[version])
  return published ? Temporal.Instant.from(published) : null
}

const bunfig: { install?: { minimumReleaseAge?: number, minimumReleaseAgeExcludes?: string[] } } = Bun.TOML.parse(await Bun.file('bunfig.toml').text())
const install = bunfig.install ?? {}
const excluded = new Set(install.minimumReleaseAgeExcludes ?? [])

const [, , base] = process.argv
if (!base) {
  throw new Error('Usage: bun packages/tooling/src/check-package-age.ts <base-ref>')
}
const before = await $`git show ${base}:bun.lock`.quiet().nothrow()
// The change that brought bun.lock (#140) moved pnpm-checked versions over unchanged.
const known = before.exitCode === 0 ? lockedVersions(before.stdout.toString()) : null
const now = lockedVersions(await Bun.file('bun.lock').text())
const added = known ? [...now].filter(spec => !known.has(spec) && !excluded.has(nameAndVersion(spec)[0])) : []

const young = (await Promise.all(added.map(async spec => ({ published: await publishedAt(spec), spec }))))
  .filter(({ published }) => published === null || tooYoung(published, install.minimumReleaseAge ?? 0))

process.stdout.write(`${known ? added.length : 'No'} package versions to check against ${base}${known ? '' : ' (it has no bun.lock)'}\n`)
if (young.length > 0) {
  for (const { spec, published } of young) {
    process.stdout.write(`::error::${spec} was published ${published ? published.toString() : 'at an unknown time'}, less than ${install.minimumReleaseAge}s ago (#94). Wait and re-run.\n`)
  }
  process.exit(1)
}
