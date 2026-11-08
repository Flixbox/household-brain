/* oxlint-disable import/no-nodejs-modules -- a temporary folder for each test's watchers; node:fs/promises and node:os are built into Bun */
/** What the tests of the writer (watch-writer.test.ts, watch-question-wait.test.ts) share: separate watcher processes over one state folder. */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'

/** A look at the writer's freshness; `started` is when the watcher started, in epoch milliseconds (long ago unless given). */
export const lookAtWriter = (started = '0') => `
  import { flush } from '${import.meta.dir}/watch-output'
  import { checkWriter } from '${import.meta.dir}/watch-writer'
  await checkWriter(${started})
  await flush()`
export const MERGED_STATE = "{ autoMerge: false, closingIssues: [], draft: false, head: 'abc1234', labels: ['question'], mergeState: 'CLEAN', ownerApprovalCommit: '', ownerApproved: false, parked: false, queued: false, state: 'MERGED' }"
export const QUESTION = `
  import { flush } from '${import.meta.dir}/watch-output'
  import { preparePr } from '${import.meta.dir}/watch-queue'
  await preparePr(7, ${MERGED_STATE})
  await flush()`

// What the fake `gh` answers besides failing: its `case` arms.
const BOT_VIEWER = String.raw`*viewer*) echo '{"data":{"viewer":{"login":"agent[bot]"}}}'; exit 0 ;;`

const dirs: string[] = []
/** For `afterEach`: removes every state folder the test made. */
export const cleanUp = async (): Promise<void> => {
  await Promise.all(dirs.splice(0).map(async dir => rm(dir, { force: true, recursive: true })))
}

/** A state folder and a `gh` that logs each call and fails, as a write GitHub refuses. */
export const setUp = async (answers = BOT_VIEWER) => {
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
export const run = async ({ env = {}, gh, home, scoped = false, script }: { env?: Record<string, string>, gh: string, home: string, scoped?: boolean, script: string }) => {
  const watcher = Bun.spawn([process.execPath, '-e', script], {
    env: { ...process.env, CLAUDE_CODE_SESSION_ID: '', CLAUDE_CONFIG_DIR: home, CLEAR_QUESTION_LABEL: '1', CODEX_THREAD_ID: '', CODEX_WATCH_THREAD: '', GH: gh, OWNER: 'owner', READY_APPROVED_DRAFTS: '1', REPO: 'owner/repo', REVIEW_BOTS: 'coderabbitai', STATE_DIR: '', WATCHER_ID: scoped ? 'agent' : 'main', WATCHER_SUBSCRIPTIONS: scoped ? 'pr:7' : '', XDG_STATE_HOME: home, ...env },
    stderr: 'ignore',
    stdout: 'pipe',
  })
  const output = await new Response(watcher.stdout).text()
  await watcher.exited
  return output
}
