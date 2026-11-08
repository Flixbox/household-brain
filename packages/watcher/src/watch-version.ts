/* oxlint-disable import/no-nodejs-modules -- node:path's posix helpers are built into Bun and git's paths are posix */
/**
 * Which version of its own code the watcher runs (#265). Bun reads every file when the watcher starts,
 * so a watcher started while its checkout was being pulled (two restarts pulling one clone at once)
 * keeps the old code for as long as it runs. It compares the code at start with the checkout's now.
 * Only what the watcher loads counts (#506): the package also holds the guard, hooks, skills and tests.
 */
import { dirname, join } from 'node:path/posix'
import { $ } from 'bun'

const PACKAGE = `${import.meta.dir}/..`
const ENTRY = 'src/watch-project.ts'
/** Not imported, but Bun reads them to load the code. */
const SETTINGS = ['package.json', 'tsconfig.json']
/** An import whose target only exists while running: the scanner doesn't report it. */
const COMPUTED_IMPORT = /\b(?:import|require)\s*\(\s*(?!['"])/u

const scanner = new Bun.Transpiler({ loader: 'ts' })

/** Every regular file of the package at HEAD: path to [blob id, text]; a symlink isn't one, so it can't be followed. Empty where it can't be read. */
const readPackage = async (): Promise<Map<string, [string, string]>> => {
  const listing = await $`git -C ${PACKAGE} ls-tree -r HEAD`.quiet().nothrow()
  const entries = listing.stdout.toString().split('\n').filter(line => line.startsWith('100'))
    .map(line => line.split('\t'))
    .map(([meta = '', path = '']) => ({ id: meta.split(' ')[2] ?? '', path }))
  const blobs = await $`git -C ${PACKAGE} cat-file --batch < ${new Response(entries.map(entry => entry.id).join('\n'))}`.quiet().nothrow()
  if (listing.exitCode !== 0 || blobs.exitCode !== 0) { return new Map() }
  let at = 0
  return new Map(entries.map(({ id, path }) => {
    const headerEnd = blobs.stdout.indexOf('\n', at)
    const start = headerEnd + 1
    const end = start + Number(blobs.stdout.toString('utf8', at, headerEnd).split(' ')[2])
    at = end + 1
    return [path, [id, blobs.stdout.toString('utf8', start, end)]]
  }))
}

const isBuiltIn = (name: string): boolean => name === 'bun' || name.startsWith('bun:') || name.startsWith('node:')

/** The package file a relative import means; null for anything else. */
const resolved = (from: string, name: string, files: Map<string, unknown>): string | null => {
  if (!name.startsWith('.')) { return null }
  const base = join(dirname(from), name)
  return [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`].find(path => files.has(path)) ?? null
}

/** The import names in some code; null where they can't all be known. */
const importNames = (text: string): string[] | null => {
  if (COMPUTED_IMPORT.test(text)) { return null }
  try {
    return scanner.scanImports(text).map(found => found.path).filter(name => !isBuiltIn(name))
  } catch {
    return null
  }
}

/** The package files one file imports; null where one of its imports can't be followed. */
const importsOf = (path: string, files: Map<string, [string, string]>): string[] | null => {
  const names = importNames(files.get(path)?.[1] ?? '')
  if (names === null) { return null }
  const targets = names.map(name => resolved(path, name, files)).filter(target => target !== null)
  return targets.length === names.length ? targets : null
}

/** Every file the watcher loads, its entry included; null when that can't be told. */
const loadedFiles = (files: Map<string, [string, string]>): Set<string> | null => {
  if (!files.has(ENTRY)) { return null }
  const seen = new Set([ENTRY])
  for (const path of seen) {
    const targets = importsOf(path, files)
    if (targets === null) { return null }
    for (const target of targets) { seen.add(target) }
  }
  return seen
}

const pathAndBlob = (path: string, files: Map<string, [string, string]>): string => `${path}:${files.get(path)?.[0] ?? ''}`

/** The blobs of the files that make up what the watcher runs, as one comparable string; null when that can't be told. */
const runningCode = async (): Promise<string | null> => {
  const files = await readPackage()
  const loaded = loadedFiles(files)
  if (loaded === null) { return null }
  const counted = [...loaded, ...SETTINGS.filter(path => files.has(path))].toSorted()
  return `files ${counted.map(path => pathAndBlob(path, files)).join(' ')}`
}

/**
 * The code the watcher runs in its checkout's current commit; '' where that can't be read (the plugin's
 * copy is no git checkout). When it can't tell which files it runs, the version is the git tree of the
 * whole package, so any change there counts, and that never equals a list of files.
 */
export const codeVersion = async (): Promise<string> => {
  const tree = await $`git -C ${PACKAGE} rev-parse HEAD:./`.quiet().nothrow()
    .then(result => (result.exitCode === 0 ? result.stdout.toString().trim() : ''), () => '')
  return tree === '' ? '' : (await runningCode().catch(() => null)) ?? tree
}

/** The code this watcher started on: read by watch-project.ts before it loads the rest (#265). */
const startState = { on: '' }
export const readStartedOn = async (): Promise<void> => {
  startState.on = await codeVersion()
}
export const startedOn = (): string => startState.on

/**
 * The line that stops a watcher whose code changed in its checkout after it started; null otherwise,
 * also while the checkout can't be read. One that couldn't be read at the start counts as changed
 * once it can: the watcher may have started on any code.
 */
export const outdatedLine = (started: string, now: string): string | null =>
  now === '' || started === now
    ? null
    : 'WATCHER_OUTDATED: its code changed in its checkout after it started, so it stops: start it again to run the new code'
