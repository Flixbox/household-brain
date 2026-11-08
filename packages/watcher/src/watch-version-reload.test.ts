/* oxlint-disable import/no-nodejs-modules -- temporary git checkouts; node:fs/promises and node:os are built into Bun */
import { afterAll, describe, expect, it } from 'bun:test'
import { $ } from 'bun'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'

const made: string[] = []
afterAll(async () => Promise.all(made.map(async dir => rm(dir, { force: true, recursive: true }))))

const source = async (name: string): Promise<string> => Bun.file(`${import.meta.dir}/${name}`).text()
const entry = await source('watch-project.ts')
const version = await source('watch-version.ts')
const main = "import { marker, startedOn } from './watch-version'\nconsole.log(JSON.stringify({ args: process.argv.slice(2), marker, started: startedOn() }))\n"
const withMarker = (value: number): string => `${version}\nexport const marker = ${value}\n`

const tempDir = async (): Promise<string> => {
  const dir = await mkdtemp(`${tmpdir()}/watch-version-reload-`)
  made.push(dir)
  return dir
}

const writeWatcher = async (dir: string): Promise<void> => {
  await Bun.write(`${dir}/packages/watcher/src/watch-project.ts`, entry)
  await Bun.write(`${dir}/packages/watcher/src/watch-version.ts`, withMarker(1))
  await Bun.write(`${dir}/packages/watcher/src/watch-main.ts`, main)
}

const commitAll = async (dir: string): Promise<void> => {
  await $`git -C ${dir} add -A`.quiet()
  await $`git -C ${dir} -c user.name=test -c user.email=test@checkout.test commit -qm change`.quiet()
}

/** A `git` that lands a commit changing watch-version.ts the first time the watcher asks git anything: a pull finishing just then. */
const gitThatPulls = async (dir: string, shims: string): Promise<void> => {
  const real = Bun.which('git') ?? 'git'
  const script = [
    '#!/bin/bash',
    `if [ ! -e '${shims}/pulled' ]; then`,
    `  touch '${shims}/pulled'`,
    `  cp '${shims}/new-version.ts' '${dir}/packages/watcher/src/watch-version.ts'`,
    `  '${real}' -C '${dir}' add -A`,
    `  '${real}' -C '${dir}' -c user.name=test -c user.email=test@checkout.test commit -qm pull`,
    'fi',
    `exec '${real}' "$@"`,
    '',
  ].join('\n')
  await Bun.write(`${shims}/new-version.ts`, withMarker(2))
  await Bun.write(`${shims}/git`, script)
  await $`chmod +x ${shims}/git`.quiet()
}

interface Report { args: string[], marker: number, started: string }

const runWatcher = async (dir: string, path: string): Promise<Report> => {
  const env = { ...process.env, PATH: path }
  const output = await $`${process.execPath} ${dir}/packages/watcher/src/watch-project.ts --follow`.env(env).quiet().text()
  return JSON.parse(output) as Report
}

describe('the version a watcher compares against (#512)', () => {
  it('is never newer than the code it runs: a pull while its first files load reloads them', async () => {
    const dir = await tempDir()
    const shims = await tempDir()
    await $`git -C ${dir} init -q`.quiet()
    await writeWatcher(dir)
    await commitAll(dir)
    await gitThatPulls(dir, shims)
    const report = await runWatcher(dir, `${shims}:${process.env.PATH ?? ''}`)
    expect(report.marker).toBe(2)
    expect(report.started).not.toBe('')
    expect(report.args).toEqual(['--follow'])
  })

  it('still starts, once, where the version can\'t be read', async () => {
    const dir = await tempDir()
    await writeWatcher(dir)
    expect(await runWatcher(dir, process.env.PATH ?? '')).toEqual({ args: ['--follow'], marker: 1, started: '' })
  })
})
