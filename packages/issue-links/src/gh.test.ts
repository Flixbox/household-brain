import { afterAll, describe, expect, test } from 'bun:test'
import { chmod, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'

const dirs: string[] = []

afterAll(async () => {
  await Promise.all(dirs.map(async dir => rm(dir, { force: true, recursive: true })))
})

/** A stand-in for a `gh`: it logs its name and arguments, and answers as GitHub would for a chain of one blocker. */
const standIn = (name: string, home: string) => String.raw`#!/bin/sh
echo "${name} $*" >> "${home}/calls"
case "$*" in
  *repos/Coarisfinia/two/issues/2/dependencies/blocked_by) echo '[[{"number":3,"repository_url":"https://api.github.com/repos/Coarisfinia/three"}]]' ;;
  *dependencies/blocked_by*) echo '[[]]' ;;
  *) echo '{"id":5}' ;;
esac
`

/** Runs the command line with `GH` unset and only the stand-ins on the PATH; the calls they got. */
const runCli = async (...args: string[]) => {
  const home = await mkdtemp(`${tmpdir()}/issue-links-`)
  dirs.push(home)
  await Promise.all(['agent-gh', 'gh'].map(async name => {
    await Bun.write(`${home}/${name}`, standIn(name, home))
    await chmod(`${home}/${name}`, 0o755)
  }))
  const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => name !== 'GH' && name !== 'GH_REPO' && name !== 'REPO'))
  const child = Bun.spawn([process.execPath, `${import.meta.dir}/cli.ts`, ...args], { cwd: home, env: { ...env, PATH: home }, stderr: 'pipe', stdout: 'pipe' })
  const [error, code] = await Promise.all([new Response(child.stderr).text(), child.exited])
  const calls = (await Bun.file(`${home}/calls`).text().catch(() => '')).split('\n').filter(line => line !== '')
  return { calls, code, error }
}

describe('the gh it asks with (#532)', () => {
  test('is the bot, never plain gh, when GH is unset', async () => {
    const { calls, code, error } = await runCli('links', 'Flixbox/one#1')
    expect(error).toBe('')
    expect(code).toBe(0)
    expect(calls.length).toBeGreaterThan(0)
    expect(calls.filter(call => !call.startsWith('agent-gh '))).toEqual([])
  })

  test('names every repository as GitHub spells it, because agent-gh picks the bot from its owner', async () => {
    const { calls, code, error } = await runCli('block', 'Flixbox/one#1', 'Coarisfinia/two#2')
    expect(error).toBe('')
    expect(code).toBe(0)
    const endpoints = calls.flatMap(call => call.split(' ').filter(word => word.startsWith('repos/')))
    expect(endpoints).toContain('repos/Coarisfinia/three/issues/3/dependencies/blocked_by')
    expect(endpoints).toContain('repos/Flixbox/one/issues/1/dependencies/blocked_by')
    expect(endpoints.filter(endpoint => endpoint.startsWith('repos/flixbox') || endpoint.startsWith('repos/coarisfinia'))).toEqual([])
  })
})
