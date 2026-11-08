/* oxlint-disable import/no-nodejs-modules -- subprocess fixtures use temporary local files and a fake gh, never GitHub */
import { afterEach, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'

const dirs: string[] = []
afterEach(async () => { await Promise.all(dirs.splice(0).map(async dir => rm(dir, { force: true, recursive: true }))) })

const LOOKS = `
  import { checkRun } from '${import.meta.dir}/watch-ci-runs'
  import { readLines } from '${import.meta.dir}/watch-state'
  const look = async () => checkRun({ label: process.env.LABEL, limitSeconds: 1200, pr: 7, sha: 'abc' })
  await look()
  await look()
  await look()
  await Bun.write(process.env.FIXTURE_HOME + '/attempt', '2')
  await look()
  await look()
  console.log('REPORTED', JSON.stringify(await readLines('reported')))
  process.exit(0)
`

// Answers as GitHub does, also a conditional question: 304 is gh's exit 1, with the headers on stdout.
const FAKE = String.raw`
  import { appendFileSync } from 'node:fs'
  const args = process.argv.slice(2).join(' ')
  const home = process.env.FIXTURE_HOME
  appendFileSync(home + '/calls', args + '\n')
  const attempt = Number(await Bun.file(home + '/attempt').text().catch(() => '1'))
  const scenario = process.env.SCENARIO
  const status = scenario === 'running' ? 'in_progress' : 'completed'
  const replaced = scenario === 'replaced' && attempt === 2
  if (args.startsWith('api -i')) {
    if (scenario === 'refused' && attempt === 2) { process.exit(1) }
    if (args.includes('If-None-Match: "e' + attempt + '"')) {
      console.log('HTTP/2.0 304 Not Modified\r\nEtag: "e' + attempt + '"\r\n\r\n')
      process.exit(1)
    }
    const newer = args.includes('head_sha=def')
    const finished = scenario === 'cancelled' || scenario === 'replaced' ? 'cancelled' : 'success'
    const conclusion = status === 'completed' ? (newer ? 'success' : finished) : null
    console.log('HTTP/2.0 200 OK\r\nEtag: "e' + attempt + '"\r\n\r\n' + JSON.stringify({ workflow_runs: [{ conclusion, id: newer ? 6 : 5, run_attempt: attempt, run_started_at: Temporal.Now.instant().toString(), status }] }))
    process.exit(0)
  }
  if (args.startsWith('run view')) { console.log(JSON.stringify({ jobs: [{ conclusion: 'success', name: 'Lint', status: 'completed' }] })); process.exit(0) }
  if (args.startsWith('run list')) {
    console.log(JSON.stringify(replaced ? [{ attempt: 1, conclusion: 'success', databaseId: 6, headSha: 'def', startedAt: Temporal.Now.instant().toString(), status: 'completed' }] : []))
    process.exit(0)
  }
  if (args.includes('/compare/')) { console.log(JSON.stringify({ status: 'ahead' })); process.exit(0) }
  if (args.startsWith('pr list')) { console.log('[]'); process.exit(0) }
  if (args.includes('mergeQueue{id}')) { console.log(''); process.exit(0) }
  console.log('{}')
`

const looks = async (scenario: string, label = 'pr') => {
  const home = await mkdtemp(`${tmpdir()}/watch-ci-runs-`)
  dirs.push(home)
  const gh = `${home}/gh`
  await Bun.write(`${home}/fake.ts`, FAKE)
  await Bun.write(gh, `#!/bin/sh\nexec "${process.execPath}" "${home}/fake.ts" "$@"\n`)
  await Bun.spawn(['chmod', '+x', gh]).exited
  const child = Bun.spawn([process.execPath, '-e', LOOKS], {
    env: { ...process.env, AGENT_USAGE_PROVIDER: 'claude', CLAUDE_CONFIG_DIR: home, CODEX_THREAD_ID: '', FIXTURE_HOME: home, GH: gh, GH_SHARE_SECONDS: '0', LABEL: label, OWNER: 'owner', REPO: 'owner/repo', SCENARIO: scenario, STATE_DIR: `${home}/state`, WATCHER_SUBSCRIPTIONS: '', XDG_STATE_HOME: home },
    stderr: 'pipe', stdout: 'pipe',
  })
  const [output, error, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
  expect({ code, error }).toEqual({ code: 0, error: '' })
  const calls = (await Bun.file(`${home}/calls`).text()).split('\n')
  return { mainReads: calls.filter(line => line.startsWith('run list')).length, output, views: calls.filter(line => line.startsWith('run view')).length }
}

test('a finished, reported run is not asked for again, and its rerun is (#401)', async () => {
  const result = await looks('passed')
  // Each attempt's jobs are read once.
  expect(result.views).toBe(2)
  expect(result.output).toContain('"pr-7 ci-passed abc"')
  expect(result.output).toContain('"pr-7 ci-passed abc 2"')
}, 30_000)

test('a run still going is read on every look, for CI_SLOW (#401)', async () => {
  const result = await looks('running')
  expect(result.views).toBe(5)
}, 30_000)

test('a run list that can\'t be read leaves the run as it was (#401)', async () => {
  const result = await looks('refused')
  expect(result.views).toBe(1)
  expect(result.output).not.toContain('ci-passed abc 2')
}, 30_000)

test('a cancelled deploy with no replacement has its jobs read once, and still asks for a replacement (#417)', async () => {
  const result = await looks('cancelled', 'deploy')
  // Each attempt's jobs are read once; the list of main's runs is what can still change it.
  expect(result.views).toBe(2)
  expect(result.mainReads).toBe(5)
  expect(result.output).toContain('"pr-7 deploy-failed abc 1"')
  expect(result.output).toContain('"pr-7 deploy-failed abc 2"')
}, 30_000)

test('a replacement that comes later still reports the deploy (#417)', async () => {
  const result = await looks('replaced', 'deploy')
  // The cancelled run's two attempts, and the replacement, once each.
  expect(result.views).toBe(3)
  expect(result.output).toContain('"pr-7 deployed def"')
  expect(result.output).not.toContain('deploy-failed abc 2')
}, 30_000)
