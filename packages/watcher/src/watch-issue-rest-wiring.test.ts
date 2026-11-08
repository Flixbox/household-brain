/* oxlint-disable import/no-nodejs-modules -- a temporary folder for each test's fake gh and its calls */
import { afterEach, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'

const dirs: string[] = []
afterEach(async () => { await Promise.all(dirs.splice(0).map(async dir => rm(dir, { force: true, recursive: true }))) })

/** A `gh` with REST's issue lists from the file `list` (a later page from `list-<page>`), GraphQL's open list, and one issue's lookup. */
const FAKE_GH = String.raw`
  import { appendFileSync, existsSync, readFileSync } from 'node:fs'
  const text = process.argv.slice(2).join(' ')
  const home = process.env.FIXTURE_HOME
  appendFileSync(home + '/calls', text + '\n')
  if (text.includes('graphql')) {
    const blockers = existsSync(home + '/cycle') ? [{ number: 5, repository: { nameWithOwner: 'owner/repo' } }] : []
    const issues = { nodes: [{ blockedBy: { nodes: blockers }, number: 5 }], pageInfo: { endCursor: null, hasNextPage: false } }
    console.log(JSON.stringify({ data: { repository: { created: { nodes: [] }, createdPrs: { nodes: [] }, issues, updated: { nodes: [] }, updatedPrs: { nodes: [] } } } }))
    process.exit(0)
  }
  if (text.startsWith('api repos')) { console.log(JSON.stringify({ closed_by: { login: 'someone' }, state: 'closed', state_reason: 'completed', title: 'Done' })); process.exit(0) }
  const page = /[?&]page=(\d+)/.exec(text)?.[1] ?? '1'
  const body = text.includes('issues/comments') ? '[]' : readFileSync(home + (page === '1' ? '/list' : '/list-' + page), 'utf8')
  const etag = 'W/"' + Bun.hash(body).toString(36) + '"'
  if (text.includes('If-None-Match: ' + etag)) { process.stdout.write('HTTP/2.0 304 Not Modified\r\nEtag: ' + etag + '\r\n\r\n'); process.exit(1) }
  process.stdout.write('HTTP/2.0 200 OK\r\nEtag: ' + etag + '\r\n\r\n' + body)
`

const now = () => Temporal.Now.instant().round({ roundingMode: 'floor', smallestUnit: 'second' }).toString()
const listed = (number: number, state: string) => ({ created_at: now(), number, state, title: `Issue ${number}`, updated_at: now(), user: { login: 'someone' } })

const fixture = async (list: unknown[]) => {
  const home = await mkdtemp(`${tmpdir()}/watch-issue-rest-`)
  dirs.push(home)
  await mkdir(`${home}/state`)
  await Bun.write(`${home}/fake.ts`, FAKE_GH)
  await Bun.write(`${home}/gh`, `#!/bin/sh\nexec "${process.execPath}" "${home}/fake.ts" "$@"\n`)
  await Bun.spawn(['chmod', '+x', `${home}/gh`]).exited
  await Bun.write(`${home}/list`, JSON.stringify(list))
  return home
}

const envOf = (home: string) => ({ ...process.env, FIXTURE_HOME: home, GH: `${home}/gh`, GH_SHARE_SECONDS: '0', GH_TOKEN: 'token-a', GITHUB_TOKEN: '', OWNER: 'someone', REPO: 'owner/repo', SELF: 'helper[bot]', STATE_DIR: `${home}/state`, XDG_STATE_HOME: home })
const IMPORTS = `const { checkIssues, checkIssueStates } = await import('${import.meta.dir}/watch-issues')
const { checkActivity } = await import('${import.meta.dir}/watch-activity')
const { flush, report, reportedLines } = await import('${import.meta.dir}/watch-output')`

/** Runs a script as a watcher process would, on the folder's state, so a second call is a restart. */
const script = async (home: string, body: string) => {
  const child = Bun.spawn([process.execPath, '-e', `${IMPORTS}\n${body}`], { env: envOf(home), stderr: 'pipe', stdout: 'pipe' })
  const [out, error, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
  return { code, error, out }
}

/** One look through to its flush, as a round ends. */
const run = async (home: string, check: string) => {
  const { code, error } = await script(home, `await ${check}()\nawait flush()`)
  expect({ code, error }).toEqual({ code: 0, error: '' })
}

const calls = async (home: string) => (await Bun.file(`${home}/calls`).text()).split('\n').filter(Boolean)
const lines = async (home: string, name: string) => (await Bun.file(`${home}/state/${name}`).text()).split('\n').filter(Boolean)

test('a new issue written while the watcher was away still reports, read through since= (#412)', async () => {
  const home = await fixture([listed(9, 'open')])
  await Bun.write(`${home}/state/issue-events`, 'issue #1\n')
  await run(home, 'checkIssues')
  expect((await calls(home)).filter(call => call.includes('issues('))).toEqual([])
  expect((await calls(home)).find(call => call.includes('issues?state=all'))).toContain('since=')
  expect(await lines(home, 'issue-events')).toEqual(['issue #1', 'issue #9'])
})

test('after a restart it goes on from its cursor, and an unchanged list is a 304 (#412)', async () => {
  const home = await fixture([listed(9, 'open')])
  await Bun.write(`${home}/state/issue-events`, 'issue #1\n')
  await run(home, 'checkIssues')
  await run(home, 'checkIssues')
  await run(home, 'checkIssues')
  const asked = (await calls(home)).filter(call => call.includes('issues?state=all'))
  expect(asked).toHaveLength(3)
  expect(asked[2]).toContain('If-None-Match')
  expect(await lines(home, 'issue-events')).toEqual(['issue #1', 'issue #9'])
})

test('a closing and a new issue reach the open list through since=, after one full read (#412)', async () => {
  const home = await fixture([listed(5, 'open')])
  await run(home, 'checkIssueStates')
  expect(await lines(home, 'open-issues')).toEqual(['5'])
  await Bun.write(`${home}/list`, JSON.stringify([listed(5, 'closed'), listed(9, 'open')]))
  await run(home, 'checkIssueStates')
  expect(await lines(home, 'open-issues')).toEqual(['9'])
  expect((await calls(home)).filter(call => call.includes('issues(states:OPEN'))).toHaveLength(1)
})

test('closing the last open issue reports, and so does opening it again (#412)', async () => {
  const home = await fixture([listed(5, 'open')])
  await run(home, 'checkIssueStates')
  await Bun.write(`${home}/list`, JSON.stringify([listed(5, 'closed')]))
  await run(home, 'checkIssueStates')
  expect(await lines(home, 'open-issues')).toEqual([])
  await Bun.write(`${home}/list`, JSON.stringify([listed(5, 'open')]))
  await run(home, 'checkIssueStates')
  expect(await lines(home, 'open-issues')).toEqual(['5'])
  expect((await calls(home)).filter(call => call.startsWith('api repos/owner/repo/issues/5'))).toHaveLength(2)
})

/** Dies the hard way once the look is done: no exit handler runs, so what the round held is never printed. */
const DIE = "process.kill(process.pid, 'SIGKILL')\nawait Bun.sleep(5000)"
const ACTIVITY = "[{ id: 'comment 1', lines: ['the owner asks'] }]"

test('a look that dies before printing leaves its issue event unseen, and the next look reports it (#435)', async () => {
  const home = await fixture([listed(9, 'open')])
  await Bun.write(`${home}/state/issue-events`, 'issue #1\n')
  await script(home, `await checkIssues()\n${DIE}`)
  expect(await lines(home, 'issue-events')).toEqual(['issue #1'])
  expect(await Bun.file(`${home}/state/issue-event-cursors`).exists()).toBe(false)
  const { out } = await script(home, 'await checkIssues()\nawait flush()')
  expect(out).toContain('#9')
  expect(await lines(home, 'issue-events')).toEqual(['issue #1', 'issue #9'])
})

test('following, an issue event is printed before it is marked seen (#435)', async () => {
  const home = await fixture([listed(9, 'open')])
  await Bun.write(`${home}/state/issue-events`, 'issue #1\n')
  const body = `process.stdout.write = () => { require('node:fs').appendFileSync('${home}/at-print', require('node:fs').readFileSync('${home}/state/issue-events')); return true }
await checkIssues()`
  const child = Bun.spawn([process.execPath, '-e', `process.argv.push('--follow')\n${IMPORTS}\n${body}\nprocess.exit(0)`], { env: envOf(home), stderr: 'pipe', stdout: 'ignore' })
  expect({ code: await child.exited, error: await new Response(child.stderr).text() }).toEqual({ code: 0, error: '' })
  expect(await Bun.file(`${home}/at-print`).text()).toBe('issue #1\n')
  expect(await lines(home, 'issue-events')).toEqual(['issue #1', 'issue #9'])
})

test('a look that dies before printing leaves a PR comment unseen, and the next look reports it (#435)', async () => {
  const home = await fixture([])
  await Bun.write(`${home}/state/pr-7-seen`, 'comment 0\n')
  await script(home, `await checkActivity(7, ${ACTIVITY})\n${DIE}`)
  expect(await lines(home, 'pr-7-seen')).toEqual(['comment 0'])
  const { out } = await script(home, `await checkActivity(7, ${ACTIVITY})\nawait flush()`)
  expect(out).toContain('the owner asks')
  expect(await lines(home, 'pr-7-seen')).toEqual(['comment 0', 'comment 1'])
})

test('a comment two checks of one round find is reported once (#435)', async () => {
  const home = await fixture([])
  await Bun.write(`${home}/state/pr-7-seen`, 'comment 0\n')
  const { out } = await script(home, `await checkActivity(7, ${ACTIVITY})\nawait checkActivity(7, ${ACTIVITY})\nawait flush()`)
  expect(out.split('the owner asks')).toHaveLength(2)
  expect(await lines(home, 'pr-7-seen')).toEqual(['comment 0', 'comment 1'])
})

test('after a capped move the next read still asks below the old cursor, and a burst can\'t hold it (#469)', async () => {
  const cursor = '2026-11-08T12:00:00Z'
  const older = { created_at: '2026-01-01T00:00:00Z', state: 'open', title: 'Old', user: { login: 'someone' } }
  const stuck = Array.from({ length: 100 }, (_item, number) => ({ ...older, number, updated_at: cursor }))
  const home = await fixture(stuck)
  await Bun.write(`${home}/list-2`, JSON.stringify([{ ...older, number: 200, updated_at: '2026-11-08T13:00:00Z' }]))
  await Bun.write(`${home}/state/issue-events`, 'issue #1\n')
  await Bun.write(`${home}/state/issue-event-cursors`, `${JSON.stringify({ comments: cursor, issues: cursor })}\n`)
  await run(home, 'checkIssues')
  const skipped = { ...older, created_at: '2026-11-08T11:59:00Z', number: 700, updated_at: '2026-11-08T11:59:00Z' }
  await Bun.write(`${home}/list`, JSON.stringify([skipped, ...stuck.slice(1)]))
  await run(home, 'checkIssues')
  const late = { ...older, created_at: '2026-11-08T11:59:30Z', number: 701, updated_at: '2026-11-08T11:59:30Z' }
  await Bun.write(`${home}/list`, JSON.stringify([late, ...stuck.slice(1)]))
  await run(home, 'checkIssues')
  const asked = (await calls(home)).filter(call => call.includes('issues?state=all') && call.endsWith('&page=1')).map(call => /since=(?<since>[^&]+)/u.exec(call)?.groups?.since)
  expect(asked).toEqual(['2026-11-08T11:58:00Z', '2026-11-08T11:58:00Z', '2026-11-08T11:59:00Z'])
  const reported = await lines(home, 'issue-events')
  expect(reported).toContain('issue #700')
  expect(reported).toContain('issue #701')
})

const CI_EVENT = "{ key: 'pr-7 event', lines: ['the event'] }"

test('a look that dies before printing leaves its event unreported, and the next look reports it (#482)', async () => {
  const home = await fixture([])
  await Bun.write(`${home}/state/reported`, 'older\n')
  await script(home, `await report(${CI_EVENT}, 7)\n${DIE}`)
  expect(await lines(home, 'reported')).toEqual(['older'])
  const { out } = await script(home, `await report(${CI_EVENT}, 7)\nawait flush()`)
  expect(out).toContain('the event')
  expect(await lines(home, 'reported')).toEqual(['older', 'pr-7 event'])
})

test('an event two pollers find at once is reported once, and counts as reported before it is written (#482)', async () => {
  const home = await fixture([])
  const { code, error, out } = await script(home, `await Promise.all([report(${CI_EVENT}, 7), report(${CI_EVENT}, 7)])
await report(${CI_EVENT}, 7)
console.log('HELD', JSON.stringify(await reportedLines()))
await flush()`)
  expect({ code, error }).toEqual({ code: 0, error: '' })
  expect(out.split('the event')).toHaveLength(2)
  expect(out).toContain('HELD ["pr-7 event"]')
  expect(await lines(home, 'reported')).toEqual(['pr-7 event'])
})

test('following, an event is printed before it is recorded as reported (#482)', async () => {
  const home = await fixture([])
  await Bun.write(`${home}/state/reported`, 'older\n')
  const body = `process.stdout.write = () => { require('node:fs').appendFileSync('${home}/at-print', require('node:fs').readFileSync('${home}/state/reported')); return true }
await report(${CI_EVENT}, 7)`
  const child = Bun.spawn([process.execPath, '-e', `process.argv.push('--follow')\n${IMPORTS}\n${body}\nprocess.exit(0)`], { env: envOf(home), stderr: 'pipe', stdout: 'ignore' })
  expect({ code: await child.exited, error: await new Response(child.stderr).text() }).toEqual({ code: 0, error: '' })
  expect(await Bun.file(`${home}/at-print`).text()).toBe('older\n')
  expect(await lines(home, 'reported')).toEqual(['older', 'pr-7 event'])
})

test('a look that dies before printing keeps the old open list, and the next look reports the closing (#482)', async () => {
  const home = await fixture([listed(5, 'open')])
  await run(home, 'checkIssueStates')
  await Bun.write(`${home}/list`, JSON.stringify([listed(5, 'closed')]))
  await script(home, `await checkIssueStates()\n${DIE}`)
  expect(await lines(home, 'open-issues')).toEqual(['5'])
  const { out } = await script(home, 'await checkIssueStates()\nawait flush()')
  expect(out).toContain('#5')
  expect(await lines(home, 'open-issues')).toEqual([])
})

test('a closing two looks of one round find is reported once (#482)', async () => {
  const home = await fixture([listed(5, 'open')])
  await run(home, 'checkIssueStates')
  await Bun.write(`${home}/list`, JSON.stringify([listed(5, 'closed')]))
  await script(home, 'await checkIssueStates()\nawait checkIssueStates()\nawait flush()')
  expect((await calls(home)).filter(call => call.startsWith('api repos/owner/repo/issues/5'))).toHaveLength(1)
})

test('a look that dies before printing keeps the cycle new, and the next look reports it, once a round (#482)', async () => {
  const home = await fixture([listed(5, 'open')])
  await Bun.write(`${home}/cycle`, '')
  await script(home, `await checkIssueStates()\n${DIE}`)
  expect(await Bun.file(`${home}/state/link-cycles`).exists()).toBe(false)
  const { out } = await script(home, 'await checkIssueStates()\nawait checkIssueStates()\nawait flush()')
  expect(out.split('LINK_CYCLE')).toHaveLength(2)
  expect(await lines(home, 'link-cycles')).toEqual(['#5 → #5'])
})
