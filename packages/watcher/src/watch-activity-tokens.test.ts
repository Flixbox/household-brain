/* oxlint-disable import/no-nodejs-modules -- a temporary folder for the watcher's state and its fake gh */
import { afterEach, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'

const dirs: string[] = []
afterEach(async () => { await Promise.all(dirs.splice(0).map(async dir => rm(dir, { force: true, recursive: true }))) })

/**
 * A `gh` that answers as FIXTURE_WHO (`bot` or `owner`) about PR 7, merged, so a scoped watcher's
 * subscription completes. Both see the owner's submitted comment; only the owner sees their pending
 * review, as GitHub answers. FAIL names the reads that are refused (`bot-activity`, `owner-pending`).
 * LATE_SUBMIT: the owner submits the review just after the bot's second read, the last before a
 * merged PR's subscription ends (the first look's answer is read again, fresh): that read lacks it,
 * and it is no longer pending for any read after it.
 */
const FAKE_GH = String.raw`
  import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
  const text = process.argv.slice(2).join(' ').replaceAll('\n', ' ')
  const who = process.env.FIXTURE_WHO
  appendFileSync(process.env.FIXTURE_HOME + '/calls', who + ': ' + text + '\n')
  const answer = value => { console.log(JSON.stringify(value)); process.exit(0) }
  if (text.includes('mergeQueue{id}')) { process.exit(0) }
  if (text.startsWith('pr list') || text.startsWith('run list')) { answer([]) }
  if (text.startsWith('api repos/')) { answer({ ahead_by: 0, commit: { message: 'main' }, commits: [], sha: 'main1' }) }
  const author = { kind: 'User', login: 'owner' }
  const createdAt = '2026-11-08T10:00:00Z'
  const line = { author, body: 'OWNER_PENDING_LINE', createdAt, databaseId: 31, line: 3, originalLine: 3, path: 'a.ts', replyTo: null, url: 'https://c.test/31' }
  const pending = { author, body: 'OWNER_PENDING_REVIEW', comments: { nodes: [line] }, createdAt, databaseId: 11, state: 'PENDING', submittedAt: null, url: 'https://c.test/11' }
  const submitted = { author, body: 'OWNER_SUBMITTED_REVIEW', comments: { nodes: [] }, createdAt, databaseId: 10, state: 'COMMENTED', submittedAt: createdAt, url: 'https://c.test/10' }
  const comment = { author, body: 'OWNER_SUBMITTED_COMMENT', createdAt, databaseId: 1, url: 'https://c.test/1' }
  const late = process.env.LATE_SUBMIT === '1'
  const readsFile = process.env.FIXTURE_HOME + '/bot-reads'
  const botReads = () => existsSync(readsFile) ? Number(readFileSync(readsFile, 'utf8')) : 0
  const submittedLate = late && botReads() >= 2
  const visible = who === 'owner' && !submittedLate ? [pending] : []
  const failing = (process.env.FAIL ?? '').split(',')
  const read = name => { if (failing.includes(who + '-' + name)) { process.exit(1) } }
  const state = { author: { login: 'agent' }, closingIssuesReferences: { nodes: [] }, headRefOid: 'head7', mergeCommit: { oid: 'merge7' }, mergeable: 'MERGEABLE', state: 'MERGED', title: 'PR 7' }
  if (text.includes('pr7: pullRequest')) {
    let value = state
    if (text.includes('reviews(last:100){nodes{databaseId')) { read('activity'); if (late && who === 'bot') { writeFileSync(readsFile, String(botReads() + 1)) } value = { comments: { nodes: [comment] }, reviews: { nodes: [submitted, ...visible] } } }
    if (text.includes('states:PENDING')) { read('pending'); value = { reviews: { nodes: visible } } }
    answer({ data: { repository: { pr7: value } } })
  }
  answer({ data: { repository: { issues: { nodes: [], pageInfo: { hasNextPage: false } } } } })
`

const WATCHER = `
  process.argv.push('--follow')
  const sleep = Bun.sleep
  Bun.sleep = ms => sleep(Math.min(ms, 20))
  await import('${import.meta.dir}/watch-project')
`

/** Writes the fake `gh` as `name`, answering as `who`. */
const fakeGh = async (home: string, name: string, who: string) => {
  await Bun.write(`${home}/${name}`, `#!/bin/sh\nFIXTURE_WHO=${who} exec "${process.execPath}" "${home}/fake.ts" "$@"\n`)
  await Bun.spawn(['chmod', '+x', `${home}/${name}`]).exited
}

/** Runs a watcher subscribed to the merged PR 7; `oneLogin` gives it the owner's `gh` for both reads. */
const runWatcher = async ({ fail = '', late = false, oneLogin = false }: { fail?: string, late?: boolean, oneLogin?: boolean } = {}) => {
  const home = await mkdtemp(`${tmpdir()}/watch-tokens-`)
  dirs.push(home)
  await Bun.write(`${home}/fake.ts`, FAKE_GH)
  await Promise.all([fakeGh(home, 'bot', 'bot'), fakeGh(home, 'owner', 'owner')])
  // Not the first look ever: what is on the PR is news.
  await Bun.write(`${home}/state/initialized`, '')
  const env = { ...process.env, ACTIVITY_GH: `${home}/owner`, AGENT_USAGE_PROVIDER: 'claude', CLAUDE_CODE_SESSION_ID: '', CLAUDE_CONFIG_DIR: home, CODEX_THREAD_ID: '', CODEX_WATCH_THREAD: '', FAIL: fail, FIXTURE_HOME: home, GH: `${home}/${oneLogin ? 'owner' : 'bot'}`, GH_SHARE_SECONDS: '0', LATE_SUBMIT: late ? '1' : '', OWNER: 'owner', REPO: 'owner/repo', SELF: 'agent', STATE_DIR: `${home}/state`, WATCHER_SUBSCRIPTIONS: 'pr:7', XDG_STATE_HOME: home }
  const watcher = Bun.spawn([process.execPath, '-e', WATCHER], { env, stderr: 'pipe', stdout: 'pipe', timeout: 8000 })
  const [output, code] = await Promise.all([new Response(watcher.stdout).text(), watcher.exited])
  const calls = (await Bun.file(`${home}/calls`).text()).split('\n').filter(Boolean)
  return { calls, code, output }
}

const ownerReads = (calls: readonly string[]) => calls.filter(call => call.startsWith('owner: ') && call.includes('pr7: pullRequest'))
const fullReads = (calls: readonly string[]) => calls.filter(call => call.includes('reviews(last:100)'))

const expectEverything = (output: string) => {
  for (const text of ['OWNER_SUBMITTED_COMMENT', 'OWNER_SUBMITTED_REVIEW', 'OWNER_PENDING_REVIEW', 'OWNER_PENDING_LINE']) {
    expect(output).toContain(text)
  }
}

test('the bot reads the activity; the owner\'s login only asks for pending reviews, which still come (#403)', async () => {
  const { calls, code, output } = await runWatcher()
  expectEverything(output)
  expect(code).toBe(3)
  expect(fullReads(calls).filter(call => call.startsWith('owner: '))).toEqual([])
  expect(ownerReads(calls).length).toBeGreaterThan(0)
  expect(ownerReads(calls).every(call => call.includes('reviews(first:1,states:PENDING)'))).toBe(true)
}, 30_000)

test('a pending review is reported once, not again as the same item from another read (#403)', async () => {
  const { output } = await runWatcher()
  expect(output.split('OWNER_PENDING_REVIEW')).toHaveLength(2)
}, 30_000)

test('when the bot cannot read the activity, the owner\'s login does: their comments still come (#403)', async () => {
  const { calls, code, output } = await runWatcher({ fail: 'bot-activity' })
  expectEverything(output)
  expect(code).toBe(3)
  expect(fullReads(calls).some(call => call.startsWith('owner: '))).toBe(true)
}, 30_000)

test('a refused pending check holds back none of the submitted comments (#403)', async () => {
  const { code, output } = await runWatcher({ fail: 'owner-pending' })
  expect(output).toContain('OWNER_SUBMITTED_COMMENT')
  expect(output).toContain('OWNER_SUBMITTED_REVIEW')
  expect(code).toBe(3)
}, 30_000)

test('a review submitted just after the bot read it is not lost between the two reads (#403)', async () => {
  const { code, output } = await runWatcher({ late: true })
  expect(output).toContain('OWNER_PENDING_REVIEW')
  expect(code).toBe(3)
}, 30_000)

test('with one login for both, one full read covers it and no pending check is made (#403)', async () => {
  const { calls, code, output } = await runWatcher({ oneLogin: true })
  expectEverything(output)
  expect(code).toBe(3)
  expect(calls.some(call => call.includes('states:PENDING'))).toBe(false)
}, 30_000)
