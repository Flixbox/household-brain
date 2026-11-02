/* oxlint-disable import/no-nodejs-modules -- isolated watcher subprocesses use temporary local state */
import { afterEach, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'

const dirs: string[] = []
afterEach(async () => { await Promise.all(dirs.splice(0).map(async dir => rm(dir, { force: true, recursive: true }))) })

const OUTPUT = `
  process.argv.push('--follow')
  const { flush, queue, report, reportUsage } = await import('${import.meta.dir}/watch-output')
  await report({ key: 'ci-own', lines: ['OWN_CI_RESULT'] }, 7)
  await report({ key: 'ci-own', lines: ['OWN_CI_RESULT'] }, 7)
  await report({ key: 'conflict-own', lines: ['OWN_CONFLICT'] }, 7)
  await report({ key: 'owner-comment', lines: ['OWN_OWNER_COMMENT'] }, 7)
  await report({ key: 'owner-approval', lines: ['OWN_OWNER_APPROVAL'] }, 7)
  await report({ key: 'unrelated', lines: ['UNRELATED_TEXT_SAYS_PR_7'] }, 8)
  await report({ key: 'main', lines: ['UNRELATED_MAIN'] })
  await report({ key: 'moved', lines: ['QUIET_MAIN_MOVED'], quiet: true }, 7)
  queue(['OWN_ISSUE_COMMENT'], { issue: 4, key: 'issue-comment-1' })
  queue(['UNRELATED_ISSUE'], { issue: 5, key: 'issue-comment-2' })
  queue(['IDLE: QUIET_HEARTBEAT'], { quiet: true })
  await reportUsage()
  await flush()
  process.exit(0)
`

const MODEL = `
  const { Subscription } = await import('${import.meta.dir}/watch-subscription-model')
  const selected = new Subscription('pr:7,issue:4')
  selected.rememberPr(9, [4])
  selected.rememberPr(8, [5])
  const linked = selected.accepts({ pr: 9 })
  const unrelated = selected.accepts({ pr: 8 })
  selected.closePr(7)
  const closedPr = selected.accepts({ pr: 7 })
  const stillIssue = selected.accepts({ issue: 4 })
  selected.closePr(9)
  const closedLinked = selected.accepts({ pr: 9 })
  const notComplete = selected.complete
  const saved = JSON.parse(JSON.stringify(selected.snapshot()))
  const resumed = new Subscription('pr:7,issue:4')
  resumed.restore(saved)
  const resumedClosed = resumed.accepts({ pr: 7 })
  resumed.closeIssue(4)
  console.log(JSON.stringify({ closedLinked, closedPr, complete: resumed.complete, linked, notComplete, resumedClosed, stillIssue, unrelated }))
`

const run = async (script: string, selection: string) => {
  const home = await mkdtemp(`${tmpdir()}/watch-subscription-`)
  dirs.push(home)
  const child = Bun.spawn([process.execPath, '-e', script], {
    env: { ...process.env, ACTIVITY_GH: 'false', AGENT_USAGE_PROVIDER: 'claude', CLAUDE_CODE_SESSION_ID: '', CLAUDE_CONFIG_DIR: home, CODEX_THREAD_ID: '', CODEX_WATCH_THREAD: '', GH: 'false', OWNER: 'owner', REPO: 'owner/repo', STATE_DIR: `${home}/state`, WATCHER_SUBSCRIPTIONS: selection, XDG_STATE_HOME: home },
    stderr: 'pipe', stdout: 'pipe',
  })
  const [output, error, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
  expect({ code, error }).toEqual({ code: 0, error: '' })
  return output
}

test('a PR subscription emits only its structured CI, conflict and owner activity without repeats (#349)', async () => {
  const output = await run(OUTPUT, 'pr:7')
  for (const own of ['OWN_CI_RESULT', 'OWN_CONFLICT', 'OWN_OWNER_COMMENT', 'OWN_OWNER_APPROVAL']) {
    expect(output).toContain(own)
  }
  expect(output.split('OWN_CI_RESULT')).toHaveLength(2)
  for (const noise of ['UNRELATED', 'OWN_ISSUE_COMMENT', 'QUIET_', 'Usage']) {
    expect(output).not.toContain(noise)
  }
})

test('the main session still receives owner events outside any subscription (#349)', async () => {
  const output = await run(OUTPUT, '')
  expect(output).toContain('UNRELATED_TEXT_SAYS_PR_7')
  expect(output).toContain('OWN_OWNER_COMMENT')
  expect(output).toContain('UNRELATED_ISSUE')
})

test('an issue subscription gets its structured issue comments and no unrelated PR text (#349)', async () => {
  const output = await run(OUTPUT, 'issue:4')
  expect(output).toContain('OWN_ISSUE_COMMENT')
  expect(output).not.toContain('UNRELATED')
  expect(output).not.toContain('OWN_CI_RESULT')
})

test('issue-linked PRs, terminal subjects and restart recovery share one subscription model (#349)', async () => {
  const output = await run(MODEL, 'pr:7,issue:4')
  expect(JSON.parse(output)).toEqual({ closedLinked: false, closedPr: false, complete: true, linked: true, notComplete: false, resumedClosed: false, stillIssue: true, unrelated: false })
})

test('invalid selections fail closed instead of silently watching the repository (#349)', async () => {
  const script = `const { Subscription } = await import('${import.meta.dir}/watch-subscription-model'); let rejected = 0; for (const raw of ['pr:0', 'pr:no', 'other:7', 'pr:7,']) { try { new Subscription(raw) } catch { rejected += 1 } } console.log(rejected)`
  expect((await run(script, '')).trim()).toBe('4')
})
