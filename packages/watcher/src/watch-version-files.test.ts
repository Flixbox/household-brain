/* oxlint-disable import/no-nodejs-modules -- temporary git checkouts; node:fs/promises and node:os are built into Bun */
import { afterAll, describe, expect, it } from 'bun:test'
import { $ } from 'bun'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'

type Files = Record<string, string>

const made: string[] = []
afterAll(async () => Promise.all(made.map(async dir => rm(dir, { force: true, recursive: true }))))

const watcherCode = await Bun.file(`${import.meta.dir}/watch-version.ts`).text()
const printer = "import { codeVersion } from './packages/watcher/src/watch-version'\nconsole.log(await codeVersion())\n"

const commit = async (repo: string, files: Files): Promise<void> => {
  await Promise.all(Object.entries(files).map(async ([path, text]) => Bun.write(`${repo}/packages/watcher/${path}`, text)))
  await $`git -C ${repo} add -A`.quiet()
  await $`git -C ${repo} -c user.name=test -c user.email=test@checkout.test commit -qm change`.quiet()
}

const versionIn = async (repo: string): Promise<string> =>
  (await $`${process.execPath} ${repo}/print.ts`.quiet().text()).trim()

const baseFiles: Files = {
  'hooks/hooks.json': '{}\n',
  'package.json': '{"name":"fixture"}\n',
  'src/guard.ts': 'export const guard = 1\n',
  'src/used.ts': 'export const used = 1\n',
  'src/watch-main.ts': "import { used } from './used'\nconsole.log(used)\n",
  'src/watch-project.ts': "import './watch-version'\nawait import('./watch-main')\n",
  'src/watch-version.ts': watcherCode,
}

/** The checkout's code version before and after a commit that changes `change`. */
const checkout = async (files: Files): Promise<string> => {
  const repo = await mkdtemp(`${tmpdir()}/watch-version-`)
  made.push(repo)
  await $`git -C ${repo} init -q`.quiet()
  await Bun.write(`${repo}/print.ts`, printer)
  await commit(repo, { ...baseFiles, ...files })
  return repo
}

const versionsAround = async (files: Files, change: Files): Promise<[string, string]> => {
  const repo = await checkout(files)
  const before = await versionIn(repo)
  await commit(repo, change)
  return [before, await versionIn(repo)]
}

const expectSame = ([before, after]: [string, string]): void => {
  expect(before).not.toBe('')
  expect(after).toBe(before)
}

const expectChanged = ([before, after]: [string, string]): void => {
  expect(before).not.toBe('')
  expect(after).not.toBe(before)
}

describe('codeVersion: only the code the watcher runs counts (#506)', () => {
  it('stays the same when a commit changes only files the watcher never loads', async () => {
    expectSame(await versionsAround({}, { 'hooks/hooks.json': '{"changed":true}\n', 'src/guard.ts': 'export const guard = 2\n' }))
  })

  it('changes with a file the watcher loads', async () => {
    expectChanged(await versionsAround({}, { 'src/used.ts': 'export const used = 2\n' }))
  })

  it('changes when the watcher starts importing a file it didn\'t load before', async () => {
    expectChanged(await versionsAround({}, { 'src/watch-main.ts': "import './guard'\nimport { used } from './used'\nconsole.log(used)\n" }))
  })

  it('changes with the package\'s own settings', async () => {
    expectChanged(await versionsAround({}, { 'package.json': '{"name":"fixture","type":"module"}\n' }))
  })
})

describe('codeVersion: when it can\'t tell what the watcher runs, any change in the package counts (#506)', () => {
  const elsewhere = { 'src/guard.ts': 'export const guard = 2\n' }

  it('an import of a package from outside the folder', async () => {
    expectChanged(await versionsAround({ 'src/watch-main.ts': "import 'some-package'\n" }, elsewhere))
  })

  it('an import computed while running', async () => {
    expectChanged(await versionsAround({ 'src/watch-main.ts': "const name = './guard'\nawait import(name)\n" }, elsewhere))
  })

  it('an import computed while running, with a comment before its bracket', async () => {
    expectChanged(await versionsAround({ 'src/watch-main.ts': "const name = './guard'\nawait import /* note */ (name)\n" }, elsewhere))
  })

  it('an import of a file that isn\'t there', async () => {
    expectChanged(await versionsAround({ 'src/watch-main.ts': "import './missing'\n" }, elsewhere))
  })

  it('an import of a symlink, whose target the scanner never sees', async () => {
    const repo = await checkout({ 'src/linked.ts': 'export const used = 1\n' })
    await $`ln -sf linked.ts ${repo}/packages/watcher/src/used.ts`.quiet()
    await commit(repo, {})
    const before = await versionIn(repo)
    await commit(repo, { 'src/linked.ts': 'export const used = 2\n' })
    expectChanged([before, await versionIn(repo)])
  })

  it('a file that can\'t be parsed', async () => {
    expectChanged(await versionsAround({ 'src/watch-main.ts': 'this is ( not code\n' }, elsewhere))
  })
})

describe('codeVersion: code loaded in ways it can\'t follow counts as can\'t tell (#515)', () => {
  const elsewhere = { 'src/guard.ts': 'export const guard = 2\n' }
  const loading = async (code: string): Promise<[string, string]> => versionsAround({ 'src/watch-main.ts': code }, elsewhere)

  it('an import built from a string and a value', async () => {
    expectChanged(await loading("const suffix = process.argv[2]\nawait import('./gu' + suffix)\n"))
  })

  it('a require built from a string and a value', async () => {
    expectChanged(await loading("const suffix = process.argv[2]\nconsole.log(require('./gu' + suffix))\n"))
  })

  it('an import of two strings the transpiler joins', async () => {
    expectChanged(await loading("await import('./gu' + 'ard')\n"))
  })

  it('import.meta.require', async () => {
    expectChanged(await loading("console.log(import.meta.require('./guard'))\n"))
  })

  it('import.meta.require kept in a variable', async () => {
    expectChanged(await loading("const load = import.meta.require\nconsole.log(load('./guard'))\n"))
  })

  it('a Worker', async () => {
    expectChanged(await loading("console.log(new Worker(new URL('./guard.ts', import.meta.url)))\n"))
  })

  it('a Worker under another name', async () => {
    expectChanged(await loading("import { Worker as Thread } from 'node:worker_threads'\nconsole.log(new Thread(new URL('./guard.ts', import.meta.url)))\n"))
  })

  it('createRequire', async () => {
    expectChanged(await loading("import { createRequire } from 'node:module'\nconsole.log(createRequire(import.meta.url)('./guard'))\n"))
  })

  it('createRequire under another name', async () => {
    expectChanged(await loading("import { createRequire as make } from 'node:module'\nconsole.log(make(import.meta.url)('./guard'))\n"))
  })
})
