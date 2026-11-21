/* oxlint-disable import/no-nodejs-modules -- subprocess fixtures use temporary local files and a fake gh, never GitHub */
import { afterAll, describe, expect, test } from 'bun:test'
import { chmod, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'

const dirs: string[] = []

afterAll(async () => {
  await Promise.all(dirs.map(async dir => rm(dir, { force: true, recursive: true })))
})

/**
 * A stand-in for a `gh`: it logs its name, its GH_REPO and its arguments, and answers as GitHub would
 * for a chain of one blocker and for Flixbox/one's two open issues, of which #1 is blocked (#592). Like
 * the real `agent-gh` outside a clone (#590), it fails without GH_REPO.
 */
const standIn = (name: string, home: string) => String.raw`#!/bin/sh
echo "${name} GH_REPO=$GH_REPO $*" >> "${home}/calls"
if [ "${name}" = agent-gh ] && [ -z "$GH_REPO" ]; then
  echo 'agent-gh-token: set GH_REPO=owner/repo, or run it inside a clone' >&2
  exit 1
fi
case "$*" in
  *repos/Coarisfinia/two/issues/2/dependencies/blocked_by) echo '[[{"number":3,"repository_url":"https://api.github.com/repos/Coarisfinia/three"}]]' ;;
  *dependencies/blocked_by*) echo '[[]]' ;;
  *repos/Flixbox/one/issues?state=open*) echo '[[{"number":1,"repository_url":"https://api.github.com/repos/Flixbox/one","issue_dependencies_summary":{"blocked_by":1}},{"number":4,"repository_url":"https://api.github.com/repos/Flixbox/one","issue_dependencies_summary":{"blocked_by":0}}]]' ;;
  "repo view --json nameWithOwner") echo '{"nameWithOwner":"Flixbox/one"}' ;;
  *) echo '{"id":5}' ;;
esac
`

/**
 * Runs the command line with `GH` unset and only the stand-ins on the PATH, plus `given`'s variables;
 * the calls they got.
 */
const runCliWith = async (given: Record<string, string>, ...args: string[]) => {
  const home = await mkdtemp(`${tmpdir()}/issue-links-`)
  dirs.push(home)
  await Promise.all(['agent-gh', 'gh'].map(async name => {
    await Bun.write(`${home}/${name}`, standIn(name, home))
    await chmod(`${home}/${name}`, 0o755)
  }))
  const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => name !== 'GH' && name !== 'GH_REPO' && name !== 'REPO'))
  const child = Bun.spawn([process.execPath, `${import.meta.dir}/cli.ts`, ...args], { cwd: home, env: { ...env, ...given, PATH: home }, stderr: 'pipe', stdout: 'pipe' })
  const [error, code] = await Promise.all([new Response(child.stderr).text(), child.exited])
  const calls = (await Bun.file(`${home}/calls`).text().catch(() => '')).split('\n').filter(line => line !== '')
  return { calls, code, error }
}

const runCli = async (...args: string[]) => runCliWith({}, ...args)

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

describe('the repository each call acts on (#590)', () => {
  const commandLines: string[][] = [
    ['block', 'Flixbox/one#1', 'Coarisfinia/two#2'],
    ['unblock', 'Flixbox/one#1', 'Coarisfinia/two#2'],
    ['links', 'Flixbox/one#1'],
    ['audit', '--repo', 'Flixbox/one'],
  ]
  test.each(commandLines)('%s works outside a clone: every call names its repository in GH_REPO, as GitHub spells it', async (...args: string[]) => {
    const { calls, code, error } = await runCli(...args)
    expect(error).toBe('')
    expect(code).toBe(0)
    expect(calls.length).toBeGreaterThan(0)
    for (const call of calls) {
      const [, given = '', ...rest] = call.split(' ')
      const endpoint = rest.find(word => word.startsWith('repos/')) ?? ''
      expect(given).toBe(`GH_REPO=${endpoint.split('/').slice(1, 3).join('/')}`)
    }
  })
})

describe('the calls without a repository of their own (#592)', () => {
  test("keep the caller's own GH_REPO, which finds the repository for a bare issue number", async () => {
    const { calls, code, error } = await runCliWith({ GH_REPO: 'Flixbox/one' }, 'links', '1')
    expect(error).toBe('')
    expect(code).toBe(0)
    expect(calls).toContain('agent-gh GH_REPO=Flixbox/one repo view --json nameWithOwner')
    expect(calls).toContain('agent-gh GH_REPO=Flixbox/one api --paginate --slurp repos/Flixbox/one/issues/1/dependencies/blocked_by')
  })
})

describe('audit (#592)', () => {
  test('asks each blocked open issue for its blockers, naming its repository in GH_REPO', async () => {
    const { calls, code, error } = await runCli('audit', '--repo', 'Flixbox/one')
    expect(error).toBe('')
    expect(code).toBe(0)
    expect(calls).toEqual([
      'agent-gh GH_REPO=Flixbox/one api --paginate --slurp repos/Flixbox/one/issues?state=open&per_page=100',
      'agent-gh GH_REPO=Flixbox/one api --paginate --slurp repos/Flixbox/one/issues/1/dependencies/blocked_by',
    ])
  })
})
