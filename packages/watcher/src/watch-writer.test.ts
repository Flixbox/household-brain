/* oxlint-disable import/no-nodejs-modules -- a temporary folder for each test's watchers; node:fs/promises and node:os are built into Bun */
import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtemp, rm, utimes } from 'node:fs/promises'
import { retryDelayMs } from './watch-write-retry'
import { tmpdir } from 'node:os'

const MINUTE = 60_000
const THREAD = "{ id: 'T1', url: 'https://example.test/t1' }"
const STATE = "{ autoMerge: false, bot: { requested: false }, decision: 'APPROVED', draft: true, head: 'abc1234', labels: [], mergeState: 'CLEAN', ownerApprovalCommit: 'abc1234', ownerApproved: true, queued: false }"

const RESOLVER = `
  import { flush } from '${import.meta.dir}/watch-output'
  import { resolveAsked } from '${import.meta.dir}/watch-dismiss'
  await resolveAsked(7, { toResolve: [${THREAD}] })
  await flush()`
const APPROVER = `
  import { checkApproval } from '${import.meta.dir}/watch-approval'
  import { flush } from '${import.meta.dir}/watch-output'
  await checkApproval(7, ${STATE})
  await flush()`
const RELAY = `
  import { flush } from '${import.meta.dir}/watch-output'
  import { relayWrites } from '${import.meta.dir}/watch-writer'
  await relayWrites(7)
  await flush()`
/** A look at the writer's freshness; `started` is when the watcher started, in epoch milliseconds (long ago unless given). */
const lookAtWriter = (started = '0') => `
  import { flush } from '${import.meta.dir}/watch-output'
  import { checkWriter } from '${import.meta.dir}/watch-writer'
  await checkWriter(${started})
  await flush()`
const MERGED_STATE = "{ autoMerge: false, closingIssues: [], draft: false, head: 'abc1234', labels: ['question'], mergeState: 'CLEAN', ownerApprovalCommit: '', ownerApproved: false, parked: false, queued: false, state: 'MERGED' }"
const QUESTION = `
  import { flush } from '${import.meta.dir}/watch-output'
  import { preparePr } from '${import.meta.dir}/watch-queue'
  await preparePr(7, ${MERGED_STATE})
  await flush()`
/** A subscribed watcher's look at the merged PR; prints whether its subscription may go on to end. `now`: the look's time, in epoch milliseconds. */
const terminalLook = (state = MERGED_STATE, now = 'Temporal.Now.instant().epochMilliseconds') => `
  import { flush } from '${import.meta.dir}/watch-output'
  import { preparePr } from '${import.meta.dir}/watch-queue'
  const ends = await preparePr(7, ${state}, ${now})
  console.log(ends ? 'LOOK_ENDS' : 'LOOK_HOLDS')
  await flush()`
const ASKER = `
  import { askBotReviews } from '${import.meta.dir}/watch-bot-review'
  import { flush } from '${import.meta.dir}/watch-output'
  await askBotReviews(7)
  await flush()`

// What the fake `gh` answers besides failing: its `case` arms.
const BOT_VIEWER = String.raw`*viewer*) echo '{"data":{"viewer":{"login":"agent[bot]"}}}'; exit 0 ;;`
const LABEL_TAKEN = String.raw`*labels/bot-review*) echo '[]'; exit 0 ;;
*"pullRequest(number: 7)"*) echo '{"data":{"repository":{"pr7":{"state":"OPEN"}}}}'; exit 0 ;;`

const dirs: string[] = []
afterEach(async () => {
  await Promise.all(dirs.splice(0).map(async dir => rm(dir, { force: true, recursive: true })))
})

/** A state folder and a `gh` that logs each call and fails, as a write GitHub refuses. */
const setUp = async (answers = BOT_VIEWER) => {
  const home = await mkdtemp(`${tmpdir()}/watch-writer-`)
  dirs.push(home)
  const gh = `${home}/gh`
  await Bun.write(gh, `#!/bin/sh\necho "$*" >> "${home}/calls"\ncase "$*" in\n${answers}\nesac\nexit 1\n`)
  await Bun.spawn(['chmod', '+x', gh]).exited
  // Only the writes: a watcher also reads (the merge queue on loading, the open PRs for its reminders).
  const calls = async () => (await Bun.file(`${home}/calls`).text().catch(() => '')).split('\n').filter(line => ['mutation{', '-X DELETE', 'viewer{'].some(part => line.includes(part)) || line.startsWith('pr ready'))
  return { calls, gh, home }
}

/** One watcher process: all-events without `scoped`, else subscribed to PR 7. */
const run = async ({ gh, home, scoped = false, script }: { gh: string, home: string, scoped?: boolean, script: string }) => {
  const watcher = Bun.spawn([process.execPath, '-e', script], {
    env: { ...process.env, CLAUDE_CODE_SESSION_ID: '', CLAUDE_CONFIG_DIR: home, CLEAR_QUESTION_LABEL: '1', CODEX_THREAD_ID: '', CODEX_WATCH_THREAD: '', GH: gh, OWNER: 'owner', READY_APPROVED_DRAFTS: '1', REPO: 'owner/repo', REVIEW_BOTS: 'coderabbitai', STATE_DIR: '', WATCHER_ID: scoped ? 'agent' : 'main', WATCHER_SUBSCRIPTIONS: scoped ? 'pr:7' : '', XDG_STATE_HOME: home },
    stderr: 'ignore',
    stdout: 'pipe',
  })
  const output = await new Response(watcher.stdout).text()
  await watcher.exited
  return output
}

describe('how long a failed write waits (#402)', () => {
  it('is 1, 2, 5 and then 10 minutes, and stays at 10', () => {
    expect([1, 2, 3, 4, 5, 20].map(failures => retryDelayMs(failures))).toEqual([MINUTE, 2 * MINUTE, 5 * MINUTE, 10 * MINUTE, 10 * MINUTE, 10 * MINUTE])
  })
})

/** The retry count left after a write answers `answer`, for a write that had failed twice and whose wait is over. */
const countAfter = async (answer: string) => {
  const { gh, home } = await setUp()
  const count = `${home}/watch-project/owner_repo/write-retries/${Bun.hash('a-write').toString(36)}`
  await Bun.write(count, '2')
  const old = Temporal.Now.instant().subtract({ hours: 1 }).epochMilliseconds / 1000
  await utimes(count, old, old)
  await run({ gh, home, script: `
    import { attemptWrite } from '${import.meta.dir}/watch-writer'
    await attemptWrite('a-write', async () => ${answer})` })
  return Bun.file(count).text().catch(() => 'gone')
}

describe('the retry count (#431)', () => {
  it('stays when the write answers that nothing was attempted', async () => {
    expect(await countAfter('null')).toBe('2')
  }, 30_000)

  it('goes up on a failure', async () => {
    expect(await countAfter('false')).toBe('3')
  }, 30_000)

  it('goes on a success', async () => {
    expect(await countAfter('true')).toBe('gone')
  }, 30_000)
})

describe('one writer (#402)', () => {
  it('the all-events watcher resolves a thread, and a failed one waits instead of being tried on the next look', async () => {
    const { calls, gh, home } = await setUp()
    expect(await run({ gh, home, script: RESOLVER })).toContain('THREAD_RESOLVE_FAILED')
    await run({ gh, home, script: RESOLVER })
    expect(await calls()).toHaveLength(1)
  }, 30_000)

  it('a subscribed watcher never writes, and still hears how the write went', async () => {
    const { calls, gh, home } = await setUp()
    const before = await run({ gh, home, scoped: true, script: RESOLVER })
    expect(before).not.toContain('THREAD_RESOLVE')
    expect(await calls()).toHaveLength(0)
    await run({ gh, home, script: RESOLVER })
    const relayed = await run({ gh, home, scoped: true, script: RELAY })
    expect(relayed).toContain('PR #7: THREAD_RESOLVE_FAILED')
    // Once, however many looks there are.
    expect(await run({ gh, home, scoped: true, script: RELAY })).not.toContain('THREAD_RESOLVE')
  }, 30_000)

  it('a subscribed watcher leaves an approved draft to the writer, without asking its agent to mark it ready', async () => {
    const { calls, gh, home } = await setUp()
    const output = await run({ gh, home, scoped: true, script: APPROVER })
    expect(output).not.toContain('APPROVED_DRAFT')
    expect(output).not.toContain('DRAFT_READY_FAILED')
    expect((await calls()).filter(call => call.startsWith('pr ready'))).toEqual([])
  }, 30_000)

  it('when the writer could not mark a draft ready, the subscribed agent hears both events', async () => {
    const { gh, home } = await setUp()
    const written = await run({ gh, home, script: APPROVER })
    expect(written).toContain('DRAFT_READY_FAILED')
    expect(written).toContain('APPROVED_DRAFT')
    const relayed = await run({ gh, home, scoped: true, script: RELAY })
    expect(relayed).toContain('DRAFT_READY_FAILED')
    expect(relayed).toContain('APPROVED_DRAFT')
  }, 30_000)

  it('does not repeat what the writer did long before a subscribed watcher started', async () => {
    const { gh, home } = await setUp()
    await run({ gh, home, script: RESOLVER })
    const outcomes = `${home}/watch-project/owner_repo/write-outcomes/pr-7`
    const old = Temporal.Now.instant().subtract({ hours: 2 }).epochMilliseconds / 1000
    const names = await Array.fromAsync(new Bun.Glob('*').scan(outcomes))
    await Promise.all(names.map(async name => utimes(`${outcomes}/${name}`, old, old)))
    expect(names.length).toBeGreaterThan(0)
    expect(await run({ gh, home, scoped: true, script: RELAY })).not.toContain('THREAD_RESOLVE')
  }, 30_000)
})

describe('no writer (#432)', () => {
  const age = async (home: string, minutes: number) => {
    const old = Temporal.Now.instant().subtract({ minutes }).epochMilliseconds / 1000
    const mark = `${home}/watch-project/owner_repo/writer-seen`
    expect(await Bun.file(mark).exists()).toBe(true)
    await utimes(mark, old, old)
  }

  it('a subscribed watcher says so once when no writer has looked for a while, and an all-events watcher never does', async () => {
    const { gh, home } = await setUp()
    expect(await run({ gh, home, script: lookAtWriter() })).not.toContain('NO_WRITER')
    await age(home, 60)
    expect(await run({ gh, home, scoped: true, script: lookAtWriter() })).toContain('NO_WRITER')
    expect(await run({ gh, home, scoped: true, script: lookAtWriter() })).not.toContain('NO_WRITER')
  }, 30_000)

  it('counts a repository no writer ever looked at', async () => {
    const { gh, home } = await setUp()
    expect(await run({ gh, home, scoped: true, script: lookAtWriter() })).toContain('NO_WRITER')
  }, 30_000)

  it('stays quiet while the writer is fresh, and while the subscribed watcher has only just started', async () => {
    const { gh, home } = await setUp()
    await run({ gh, home, script: lookAtWriter() })
    expect(await run({ gh, home, scoped: true, script: lookAtWriter() })).not.toContain('NO_WRITER')
    // A paced writer's longest pause (#407) is no absence.
    await age(home, 25)
    expect(await run({ gh, home, scoped: true, script: lookAtWriter() })).not.toContain('NO_WRITER')
    await age(home, 60)
    expect(await run({ gh, home, scoped: true, script: lookAtWriter('Temporal.Now.instant().epochMilliseconds') })).not.toContain('NO_WRITER')
  }, 30_000)

  it('says so again when a writer came back and went away again', async () => {
    const { gh, home } = await setUp()
    await run({ gh, home, script: lookAtWriter() })
    await age(home, 60)
    expect(await run({ gh, home, scoped: true, script: lookAtWriter() })).toContain('NO_WRITER')
    await run({ gh, home, script: lookAtWriter() })
    await age(home, 120)
    expect(await run({ gh, home, scoped: true, script: lookAtWriter() })).toContain('NO_WRITER')
  }, 30_000)
})

describe('the bot-review ask and the question label come from the writer too (#415)', () => {
  it('a failed removal of the question label waits instead of being tried on the next look', async () => {
    const { calls, gh, home } = await setUp()
    expect(await run({ gh, home, script: QUESTION })).toContain('QUESTION_CLEAR_FAILED')
    await run({ gh, home, script: QUESTION })
    expect((await calls()).filter(call => call.includes('-X DELETE'))).toHaveLength(1)
  }, 30_000)

  it('a viewer that cannot be read waits too, and is not taken for a failed removal', async () => {
    const { calls, gh, home } = await setUp('')
    expect(await run({ gh, home, script: QUESTION })).toContain("couldn't ask GitHub")
    await run({ gh, home, script: QUESTION })
    expect(await calls()).toHaveLength(1)
  }, 30_000)

  it('a subscribed watcher asks GitHub nothing about the question label', async () => {
    const { calls, gh, home } = await setUp()
    expect(await run({ gh, home, scoped: true, script: QUESTION })).not.toContain('QUESTION_CLEAR')
    expect(await calls()).toEqual([])
  }, 30_000)

  it('a subscribed watcher hears what the writer did on a merged PR, on its own look at it', async () => {
    const { calls, gh, home } = await setUp()
    await run({ gh, home, script: QUESTION })
    expect(await run({ gh, home, scoped: true, script: QUESTION })).toContain('PR #7: QUESTION_CLEAR_FAILED')
    expect((await calls()).filter(call => call.includes('-X DELETE'))).toHaveLength(1)
  }, 30_000)

  it('a subscribed watcher holds a merged PR that still carries the label while a writer runs (#440)', async () => {
    const { gh, home } = await setUp()
    await run({ gh, home, script: lookAtWriter() })
    expect(await run({ gh, home, scoped: true, script: terminalLook() })).toContain('LOOK_HOLDS')
  }, 30_000)

  it('a wait outlasts the label: the writer takes it off before it leaves its outcome', async () => {
    const { gh, home } = await setUp()
    await run({ gh, home, script: lookAtWriter() })
    await run({ gh, home, scoped: true, script: terminalLook() })
    const unlabelled = MERGED_STATE.replace("labels: ['question']", 'labels: []')
    expect(await run({ gh, home, scoped: true, script: terminalLook(unlabelled) })).toContain('LOOK_HOLDS')
  }, 30_000)

  it('a wait belongs to its head: a new head waits afresh', async () => {
    const { gh, home } = await setUp()
    await run({ gh, home, script: lookAtWriter() })
    const tenMinutesAgo = String(Temporal.Now.instant().epochMilliseconds - 10 * MINUTE)
    await run({ gh, home, scoped: true, script: terminalLook(MERGED_STATE, tenMinutesAgo) })
    const newHead = MERGED_STATE.replace("head: 'abc1234'", "head: 'def5678'")
    expect(await run({ gh, home, scoped: true, script: terminalLook(newHead) })).toContain('LOOK_HOLDS')
  }, 30_000)

  it('it lets go once the outcome has been relayed', async () => {
    const { gh, home } = await setUp()
    await run({ gh, home, script: lookAtWriter() })
    await run({ gh, home, scoped: true, script: terminalLook() })
    await run({ gh, home, script: QUESTION })
    const look = await run({ gh, home, scoped: true, script: terminalLook() })
    expect(look).toContain('PR #7: QUESTION_CLEAR_FAILED')
    expect(look).toContain('LOOK_ENDS')
  }, 30_000)

  it('it waits a bounded time: past the bound the look ends without an outcome', async () => {
    const { gh, home } = await setUp()
    await run({ gh, home, script: lookAtWriter() })
    const tenMinutesAgo = String(Temporal.Now.instant().epochMilliseconds - 10 * MINUTE)
    expect(await run({ gh, home, scoped: true, script: terminalLook(MERGED_STATE, tenMinutesAgo) })).toContain('LOOK_HOLDS')
    expect(await run({ gh, home, scoped: true, script: terminalLook() })).toContain('LOOK_ENDS')
  }, 30_000)

  it('it does not wait when no writer is running, or the label is off', async () => {
    const { gh, home } = await setUp()
    expect(await run({ gh, home, scoped: true, script: terminalLook() })).toContain('LOOK_ENDS')
    await run({ gh, home, script: lookAtWriter() })
    const unlabelled = MERGED_STATE.replace("labels: ['question']", 'labels: []')
    expect(await run({ gh, home, scoped: true, script: terminalLook(unlabelled) })).toContain('LOOK_ENDS')
  }, 30_000)

  it('a claim on the bot-review label that fails waits instead of being tried on the next look', async () => {
    const { calls, gh, home } = await setUp('')
    await run({ gh, home, script: ASKER })
    await run({ gh, home, script: ASKER })
    expect(await calls()).toHaveLength(1)
  }, 30_000)

  it('a subscribed watcher never claims the bot-review label', async () => {
    const { calls, gh, home } = await setUp(LABEL_TAKEN)
    expect(await run({ gh, home, scoped: true, script: ASKER })).not.toContain('BOT_REVIEW')
    expect(await calls()).toEqual([])
  }, 30_000)

  it('a subscribed watcher hears a failed ask, and the writer waits before asking again', async () => {
    const { calls, gh, home } = await setUp(LABEL_TAKEN)
    expect(await run({ gh, home, script: ASKER })).toContain('BOT_REVIEW_FAILED')
    await run({ gh, home, script: ASKER })
    expect(await calls()).toHaveLength(1)
    expect(await run({ gh, home, scoped: true, script: RELAY })).toContain('PR #7: BOT_REVIEW_FAILED')
  }, 30_000)
})
