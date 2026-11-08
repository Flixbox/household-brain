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

const dirs: string[] = []
afterEach(async () => {
  await Promise.all(dirs.splice(0).map(async dir => rm(dir, { force: true, recursive: true })))
})

/** A state folder and a `gh` that logs each call and fails, as a write GitHub refuses. */
const setUp = async () => {
  const home = await mkdtemp(`${tmpdir()}/watch-writer-`)
  dirs.push(home)
  const gh = `${home}/gh`
  await Bun.write(gh, `#!/bin/sh\necho "$*" >> "${home}/calls"\nexit 1\n`)
  await Bun.spawn(['chmod', '+x', gh]).exited
  // Only the writes: a watcher also reads (the merge queue on loading, the open PRs for its reminders).
  const calls = async () => (await Bun.file(`${home}/calls`).text().catch(() => '')).split('\n').filter(line => line.includes('mutation{') || line.startsWith('pr ready'))
  return { calls, gh, home }
}

/** One watcher process: all-events without `scoped`, else subscribed to PR 7. */
const run = async ({ gh, home, scoped = false, script }: { gh: string, home: string, scoped?: boolean, script: string }) => {
  const watcher = Bun.spawn([process.execPath, '-e', script], {
    env: { ...process.env, CLAUDE_CODE_SESSION_ID: '', CLAUDE_CONFIG_DIR: home, CODEX_THREAD_ID: '', CODEX_WATCH_THREAD: '', GH: gh, OWNER: 'owner', READY_APPROVED_DRAFTS: '1', REPO: 'owner/repo', STATE_DIR: '', WATCHER_ID: scoped ? 'agent' : 'main', WATCHER_SUBSCRIPTIONS: scoped ? 'pr:7' : '', XDG_STATE_HOME: home },
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
