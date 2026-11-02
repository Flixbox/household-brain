/* oxlint-disable import/no-nodejs-modules -- subprocess fixtures use temporary local files and a fake gh, never GitHub */
import { afterEach, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'

const dirs: string[] = []
afterEach(async () => { await Promise.all(dirs.splice(0).map(async dir => rm(dir, { force: true, recursive: true }))) })

const CHECK = `
  import { checkNotQueued } from '${import.meta.dir}/watch-queue'
  import { readLines, writeLines } from '${import.meta.dir}/watch-state'
  const state = { autoMerge: true, draft: false, head: 'abc', mergeState: 'CLEAN', ownerApproved: true, parked: false, queued: false, state: 'OPEN' }
  const seed = async head => {
    const now = Temporal.Now.instant()
    await writeLines('unqueued', ['7 ' + head + ' ' + now.subtract({ minutes: 6 }).toString() + ' ' + now.toString()])
  }
  await writeLines('reported', process.env.SCENARIO === 'reported' ? ['pr-7 not-queued abc'] : [])
  await seed('abc')
  await checkNotQueued(7, state)
  if (process.env.SCENARIO === 'new-head') {
    state.head = 'def'
    await checkNotQueued(7, state)
    console.log('NEW_HEAD_FIRST', JSON.stringify(await readLines('reported')))
    await seed('def')
    await checkNotQueued(7, state)
    await checkNotQueued(7, state)
  }
  if (process.env.SCENARIO === 'retry') {
    await checkNotQueued(7, state)
    await checkNotQueued(7, state)
  }
  console.log('REPORTED', JSON.stringify(await readLines('reported')))
`

const FAKE = String.raw`
  import { appendFileSync } from 'node:fs'
  const args = process.argv.slice(2).join(' ')
  const home = process.env.FIXTURE_HOME
  appendFileSync(home + '/calls', args + '\n')
  if (args.includes('mergeQueue{id}')) { console.log('queue-id'); process.exit(0) }
  if (args.startsWith('run list')) {
    console.log(JSON.stringify([{ attempt: 1, conclusion: 'success', databaseId: 1, startedAt: Temporal.Now.instant().toString(), status: 'completed' }]))
    process.exit(0)
  }
  if (args.includes('pullRequest(number:7)')) {
    const count = Number(await Bun.file(home + '/looks').text().catch(() => '0')) + 1
    await Bun.write(home + '/looks', String(count))
    if (process.env.SCENARIO === 'retry' && count === 1) { process.exit(1) }
    const head = count === 1 || process.env.SCENARIO !== 'new-head' ? 'abc' : 'def'
    const value = { autoMergeRequest: { enabledAt: 't0' }, commits: { nodes: [{ commit: { statusCheckRollup: { state: 'SUCCESS' } } }] }, headRefOid: head, id: 'PR_test', isDraft: false, isInMergeQueue: process.env.SCENARIO === 'queued', mergeStateStatus: 'CLEAN', state: 'OPEN' }
    console.log(JSON.stringify({ data: { repository: { pullRequest: value } } })); process.exit(0)
  }
  console.log('{}')
`

const fixture = async (scenario: string) => {
  const home = await mkdtemp(`${tmpdir()}/watch-queue-`)
  dirs.push(home)
  const gh = `${home}/gh`
  await Bun.write(`${home}/fake.ts`, FAKE)
  await Bun.write(gh, `#!/bin/sh\nexec "${process.execPath}" "${home}/fake.ts" "$@"\n`)
  await Bun.spawn(['chmod', '+x', gh]).exited
  const child = Bun.spawn([process.execPath, '-e', CHECK], {
    env: { ...process.env, AGENT_USAGE_PROVIDER: 'claude', CLAUDE_CONFIG_DIR: home, CODEX_THREAD_ID: '', FIXTURE_HOME: home, GH: gh, GH_SHARE_SECONDS: '0', OWNER: 'owner', REPO: 'owner/repo', SCENARIO: scenario, STATE_DIR: `${home}/state`, XDG_STATE_HOME: home },
    stderr: 'pipe', stdout: 'pipe',
  })
  const [output, error, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
  expect({ code, error }).toEqual({ code: 0, error: '' })
  const calls = (await Bun.file(`${home}/calls`).text()).split('\n')
  return { fresh: calls.filter(line => line.includes('pullRequest(number:7)')).length, output, runs: calls.filter(line => line.startsWith('run list')).length }
}

test('a reported NOT_QUEUED head makes no fresh GraphQL or run lookup (#348)', async () => {
  const result = await fixture('reported')
  expect(result.fresh).toBe(0)
  expect(result.runs).toBe(0)
})

test('a fresh GraphQL rejection does not ask for the workflow run (#348)', async () => {
  const result = await fixture('queued')
  expect(result.fresh).toBe(1)
  expect(result.runs).toBe(0)
  expect(result.output).not.toContain('pr-7 not-queued abc')
})

test('a failed fresh lookup stays retryable and a successful report stops more lookups (#348)', async () => {
  const result = await fixture('retry')
  expect(result.fresh).toBe(2)
  expect(result.runs).toBe(1)
  expect(result.output).toContain('pr-7 not-queued abc')
})

test('a new head starts timing again and reports independently from the previous head (#348)', async () => {
  const result = await fixture('new-head')
  expect(result.output).toContain('NEW_HEAD_FIRST ["pr-7 not-queued abc"]')
  expect(result.output).toContain('pr-7 not-queued def')
  expect(result.fresh).toBe(2)
  expect(result.runs).toBe(2)
})
