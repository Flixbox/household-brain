/* oxlint-disable import/no-nodejs-modules -- subprocess fixtures use temporary local files and a fake gh, never GitHub */
import { afterEach, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'

const dirs: string[] = []
afterEach(async () => { await Promise.all(dirs.splice(0).map(async dir => rm(dir, { force: true, recursive: true }))) })

const LOOKS = `
  import { checkMainRun, checkRun } from '${import.meta.dir}/watch-ci-runs'
  import { mkdir } from 'node:fs/promises'
  import { reportedLines } from '${import.meta.dir}/watch-output'
  const look = async () => process.env.LABEL === 'main' ? checkMainRun(1200) : checkRun({ label: process.env.LABEL, limitSeconds: 1200, pr: 7, sha: 'abc' })
  await look()
  await look()
  await look()
  await Bun.write(process.env.FIXTURE_HOME + '/attempt', '2')
  // The run list's shared answer runs out before the jobs' does, as it did on the live watcher (#493).
  const answers = process.env.XDG_STATE_HOME + '/watch-project/gh-answers'
  await mkdir(answers, { recursive: true })
  for (const name of new Bun.Glob('*').scanSync(answers)) {
    if ((await Bun.file(answers + '/' + name).text()).includes('workflow_runs')) { await Bun.file(answers + '/' + name).delete() }
  }
  await look()
  await look()
  console.log('REPORTED', JSON.stringify(await reportedLines()))
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
  const status = scenario === 'running' || (scenario === 'finishing' && attempt === 1) ? 'in_progress' : 'completed'
  const jobsDone = scenario !== 'stuck' && (!['finishing', 'lagging'].includes(scenario) || attempt === 2)
  const batched = ['batched', 'unrelated', 'busy', 'saturated'].includes(scenario)
  const replaced = batched || (scenario === 'replaced' && attempt === 2)
  // Started past the limit, still going, and its jobs either listed or never readable (#570).
  const longAgo = Temporal.Now.instant().subtract({ minutes: 30 }).toString()
  const unreadable = ['unreadable', 'main-unreadable'].includes(scenario)
  if (args.startsWith('run view') && unreadable) { process.exit(1) }
  if (args.startsWith('run list') && scenario.startsWith('main-')) {
    console.log(JSON.stringify([{ attempt: 1, conclusion: '', databaseId: 5, headSha: 'abc', startedAt: longAgo, status: 'in_progress' }]))
    process.exit(0)
  }
  if (args.startsWith('api -i') && scenario === 'unreadable') {
    console.log('HTTP/2.0 200 OK\r\n\r\n' + JSON.stringify({ workflow_runs: [{ conclusion: null, id: 5, run_attempt: 1, run_started_at: longAgo, status: 'in_progress' }] }))
    process.exit(0)
  }
  if (args.startsWith('api -i')) {
    if (scenario === 'refused' && attempt === 2) { process.exit(1) }
    if (args.includes('If-None-Match: "e' + attempt + '"')) {
      console.log('HTTP/2.0 304 Not Modified\r\nEtag: "e' + attempt + '"\r\n\r\n')
      process.exit(1)
    }
    if (batched && args.includes('head_sha=abc')) {
      console.log('HTTP/2.0 200 OK\r\nEtag: "e' + attempt + '"\r\n\r\n' + JSON.stringify({ workflow_runs: [] }))
      process.exit(0)
    }
    if (scenario === 'merge-group') {
      const pushRuns = attempt === 2 ? [{ conclusion: 'success', id: 6, run_attempt: 1, run_started_at: Temporal.Now.instant().toString(), status: 'completed' }] : []
      const otherBranch = [{ conclusion: 'success', id: 8, run_attempt: 1, run_started_at: Temporal.Now.instant().toString(), status: 'completed' }]
      const queueRuns = [{ conclusion: 'success', id: 4, run_attempt: 1, run_started_at: Temporal.Now.instant().toString(), status: 'completed' }]
      console.log('HTTP/2.0 200 OK\r\nEtag: "e' + attempt + '"\r\n\r\n' + JSON.stringify({ workflow_runs: args.includes('event=push') ? (args.includes('branch=main') ? pushRuns : otherBranch) : queueRuns }))
      process.exit(0)
    }
    if (scenario === 'busy' && args.includes('head_sha=ghi')) {
      console.log('HTTP/2.0 200 OK\r\nEtag: "e' + attempt + '"\r\n\r\n' + JSON.stringify({ workflow_runs: [{ conclusion: 'failure', id: 9, run_attempt: 1, run_started_at: Temporal.Now.instant().toString(), status: 'completed' }] }))
      process.exit(0)
    }
    const newer = args.includes('head_sha=def')
    const finished = scenario === 'cancelled' || scenario === 'replaced' ? 'cancelled' : 'success'
    const conclusion = status === 'completed' ? (newer ? 'success' : finished) : null
    console.log('HTTP/2.0 200 OK\r\nEtag: "e' + attempt + '"\r\n\r\n' + JSON.stringify({ workflow_runs: [{ conclusion, id: newer ? 6 : 5, run_attempt: scenario === 'stuck' ? 1 : attempt, run_started_at: Temporal.Now.instant().toString(), status }] }))
    process.exit(0)
  }
  if (args.startsWith('run view')) { console.log(JSON.stringify({ jobs: [{ conclusion: jobsDone ? 'success' : null, name: 'Lint', status: jobsDone ? 'completed' : 'in_progress' }] })); process.exit(0) }
  if (args.startsWith('run list') && scenario === 'busy') {
    // Newest first: a later batch that failed, the batch that deployed abc, and a run from before abc.
    const run = (databaseId, headSha, conclusion) => ({ attempt: 1, conclusion, databaseId, headSha, startedAt: Temporal.Now.instant().toString(), status: 'completed' })
    console.log(JSON.stringify([run(9, 'ghi', 'failure'), run(6, 'def', 'success'), run(3, 'old', 'success')]))
    process.exit(0)
  }
  if (args.startsWith('run list') && scenario === 'saturated') {
    // A full page of runs that all contain abc: the one that deployed it may be older still.
    console.log(JSON.stringify(Array.from({ length: 100 }, (_, index) => ({ attempt: 1, conclusion: 'success', databaseId: 200 - index, headSha: 'r' + index, startedAt: Temporal.Now.instant().toString(), status: 'completed' }))))
    process.exit(0)
  }
  if (args.startsWith('run list')) {
    console.log(JSON.stringify(replaced ? [{ attempt: 1, conclusion: 'success', databaseId: 6, headSha: 'def', startedAt: Temporal.Now.instant().toString(), status: 'completed' }] : []))
    process.exit(0)
  }
  if (args.includes('/compare/')) { console.log(JSON.stringify({ status: scenario === 'unrelated' || args.includes('abc...old') ? 'behind' : 'ahead' })); process.exit(0) }
  if (args.startsWith('pr list')) { console.log('[]'); process.exit(0) }
  if (args.includes('mergeQueue{id}')) { console.log(''); process.exit(0) }
  console.log('{}')
`

const looks = async (scenario: string, label = 'pr', { reported = [], selection = '' }: { reported?: readonly string[], selection?: string } = {}) => {
  const home = await mkdtemp(`${tmpdir()}/watch-ci-runs-`)
  dirs.push(home)
  const gh = `${home}/gh`
  await Bun.write(`${home}/fake.ts`, FAKE)
  await Bun.write(`${home}/state/reported`, reported.map(line => `${line}\n`).join(''))
  await Bun.write(gh, `#!/bin/sh\nexec "${process.execPath}" "${home}/fake.ts" "$@"\n`)
  await Bun.spawn(['chmod', '+x', gh]).exited
  const child = Bun.spawn([process.execPath, '-e', LOOKS], {
    env: { ...process.env, AGENT_USAGE_PROVIDER: 'claude', CLAUDE_CONFIG_DIR: home, CODEX_THREAD_ID: '', FIXTURE_HOME: home, GH: gh, GH_SHARE_SECONDS: scenario === 'finishing' ? '60' : '0', LABEL: label, OWNER: 'owner', REPO: 'owner/repo', SCENARIO: scenario, STATE_DIR: `${home}/state`, WATCHER_SUBSCRIPTIONS: selection, XDG_STATE_HOME: home },
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
  expect(result.output).toContain('"pr-7 ci-passed abc 5 1"')
  expect(result.output).toContain('"pr-7 ci-passed abc 5 2"')
}, 30_000)

test('a result recorded before the run id is not reported again, and takes the new key (#486)', async () => {
  const result = await looks('passed', 'pr', { reported: ['pr-7 ci-passed abc'] })
  // Attempt 1 is the recorded one; only attempt 2 is news.
  expect(result.output.match(/CI_PASSED for/gu)).toHaveLength(1)
  expect(result.output).toContain('"pr-7 ci-passed abc 5 1"')
  expect(result.output).not.toContain('"pr-7 ci-passed abc"')
}, 30_000)

test('a run still going is read on every look, for CI_SLOW (#401)', async () => {
  const result = await looks('running')
  expect(result.views).toBe(5)
}, 30_000)

test('a run list that can\'t be read leaves the run as it was (#401)', async () => {
  const result = await looks('refused')
  expect(result.views).toBe(1)
  expect(result.output).not.toContain('ci-passed abc 5 2')
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

test('a deploy is read from the push run on main, not another run of the same commit (#549)', async () => {
  const result = await looks('merge-group', 'deploy')
  expect(result.output).toContain('DEPLOYED: live (run 6)')
  expect(result.output).not.toContain('(run 4)')
  expect(result.output).not.toContain('(run 8)')
}, 30_000)

test('a commit merged in a batch, with no push run of its own, reports the run on main that contains it (#549)', async () => {
  const result = await looks('batched', 'deploy')
  expect(result.output).toContain('DEPLOYED: live (run 6)')
  expect(result.output).toContain('"pr-7 deployed def"')
}, 30_000)

test('a batch-merged commit reports the oldest run on main that contains it, not a later one (#558)', async () => {
  const result = await looks('busy', 'deploy')
  expect(result.output).toContain('DEPLOYED: live (run 6)')
  expect(result.output).not.toContain('run 9')
  expect(result.output).not.toContain('(run 3)')
}, 30_000)

test('a batch-merged commit is not given a deploy when every run read contains it, as an older one may have deployed it (#558)', async () => {
  const result = await looks('saturated', 'deploy')
  expect(result.output).not.toContain('DEPLOYED')
}, 30_000)

test('a run on main that does not contain the commit is not taken for its deploy (#549)', async () => {
  const result = await looks('unrelated', 'deploy')
  expect(result.output).not.toContain('DEPLOYED')
}, 30_000)

test('a run that finished is reported with its jobs as they are now, not a shared answer from before (#493)', async () => {
  const result = await looks('finishing')
  // Shared while the run went on, and asked again once it had finished.
  expect(result.views).toBe(2)
  expect(result.output).toContain('Lint: completed success')
  expect(result.output).not.toContain('Lint: in_progress')
}, 30_000)

test('a passed run whose jobs still read as running waits a look (#493)', async () => {
  const result = await looks('lagging')
  expect(result.output).not.toContain('Lint: in_progress')
  expect(result.output).toContain('CI_PASSED')
}, 30_000)

test('a passed run whose jobs never finish is reported after a few looks, with the jobs as they are (#493)', async () => {
  const result = await looks('stuck')
  // Held for three looks, reported on the fourth, and then finished with.
  expect(result.views).toBe(4)
  expect(result.output).toContain('CI_PASSED')
  expect(result.output).toContain('Lint: in_progress')
}, 30_000)

test('a slow run on main has its jobs read once, for MAIN_SLOW (#557)', async () => {
  const result = await looks('main-slow', 'main')
  expect(result.views).toBe(1)
  expect(result.output.match(/MAIN_SLOW: CI run 5 on main/gu)).toHaveLength(1)
}, 30_000)

test('a scoped watcher, which never reports MAIN_SLOW, does not read the slow run\'s jobs (#570)', async () => {
  const result = await looks('main-slow', 'main', { selection: 'pr:7' })
  expect(result.views).toBe(0)
  expect(result.output).not.toContain('MAIN_SLOW')
}, 30_000)

test('a slow run on main whose jobs never read is still reported, without them, after a few looks (#570)', async () => {
  const result = await looks('main-unreadable', 'main')
  // Failed on three looks, reported on the third, and not asked for again.
  expect(result.views).toBe(3)
  expect(result.output).toContain('MAIN_SLOW: CI run 5 on main still in_progress after 30 min. Cancel it and read the logs.')
  expect(result.output).toContain('"main-slow 5 1"')
}, 30_000)

test('a slow PR run whose jobs never read is still reported, without them, after a few looks (#570)', async () => {
  const result = await looks('unreadable')
  expect(result.output).toContain('CI_SLOW: run 5 (pr, abc) still in_progress after 30 min. Cancel it and read the logs.')
  expect(result.output).toContain('"pr-7 ci-slow 5 1"')
}, 30_000)
