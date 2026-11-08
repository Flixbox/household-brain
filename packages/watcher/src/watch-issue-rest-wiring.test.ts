/* oxlint-disable import/no-nodejs-modules -- a temporary folder for each test's fake gh and its calls */
import { afterEach, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'

const dirs: string[] = []
afterEach(async () => { await Promise.all(dirs.splice(0).map(async dir => rm(dir, { force: true, recursive: true }))) })

/** A `gh` with REST's issue lists from the file `list` (a later page from `list-<page>`), GraphQL's open list, and one issue's lookup. */
const FAKE_GH = String.raw`
  import { appendFileSync, readFileSync } from 'node:fs'
  const text = process.argv.slice(2).join(' ')
  const home = process.env.FIXTURE_HOME
  appendFileSync(home + '/calls', text + '\n')
  if (text.includes('graphql')) {
    const issues = { nodes: [{ blockedBy: { nodes: [] }, number: 5 }], pageInfo: { endCursor: null, hasNextPage: false } }
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

/** Runs one check as a watcher process would, on the folder's state, so a second call is a restart. */
const run = async (home: string, check: string) => {
  const script = `const { ${check} } = await import('${import.meta.dir}/watch-issues')\nawait ${check}()`
  const env = { ...process.env, FIXTURE_HOME: home, GH: `${home}/gh`, GH_SHARE_SECONDS: '0', GH_TOKEN: 'token-a', GITHUB_TOKEN: '', OWNER: 'someone', REPO: 'owner/repo', SELF: 'helper[bot]', STATE_DIR: `${home}/state`, XDG_STATE_HOME: home }
  const child = Bun.spawn([process.execPath, '-e', script], { env, stderr: 'pipe', stdout: 'ignore' })
  const [error, code] = await Promise.all([new Response(child.stderr).text(), child.exited])
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
  expect(await lines(home, 'issue-events')).toEqual(expect.arrayContaining(['issue #700', 'issue #701']))
})
