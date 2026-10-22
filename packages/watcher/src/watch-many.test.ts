/* oxlint-disable import/no-nodejs-modules -- a temporary folder for each test's watchers; node:fs/promises and node:os are built into Bun */
import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'

// Each watcher is its own process, as in real use. REPO is set so that loading the modules asks
// GitHub nothing; `false` as GH answers every other call with a failure, and CLAUDE_CONFIG_DIR holds
// no login, so the usage isn't asked for either.
const REPORTER = `
  import { flush, report } from '${import.meta.dir}/watch-output'
  await report({ key: 'main-head 1234567', lines: ['MAIN_ADVANCED: main is at 1234567: a change'] })
  await flush()`
const ASKER = `
  import { ghText } from '${import.meta.dir}/watch-gh'
  console.log(await ghText(['pr', 'list', '--repo', 'owner/repo'], process.env.GH, process.env.FRESH === '1'))`

const dirs: string[] = []
afterEach(async () => {
  await Promise.all(dirs.splice(0).map(async dir => rm(dir, { force: true, recursive: true })))
})

const stateHome = async () => {
  const dir = await mkdtemp(`${tmpdir()}/watch-many-`)
  dirs.push(dir)
  return dir
}

const run = async (script: string, home: string, env: Record<string, string>) => {
  const watcher = Bun.spawn([process.execPath, '-e', script], {
    env: { ...process.env, CLAUDE_CODE_SESSION_ID: '', CLAUDE_CONFIG_DIR: home, GH: 'false', REPO: 'owner/repo', STATE_DIR: '', WATCHER_ID: '', XDG_STATE_HOME: home, ...env },
    stderr: 'ignore',
    stdout: 'pipe',
  })
  const output = await new Response(watcher.stdout).text()
  return { code: await watcher.exited, output }
}

describe('many watchers on one repository (#264)', () => {
  it('each report every event, and one started again in its session goes on where it stopped', async () => {
    const home = await stateHome()
    const [one, other] = await Promise.all([run(REPORTER, home, { CLAUDE_CODE_SESSION_ID: 'session-a' }), run(REPORTER, home, { CLAUDE_CODE_SESSION_ID: 'session-b' })])
    expect([one.code, other.code]).toEqual([0, 0])
    expect(one.output).toContain('MAIN_ADVANCED: main is at 1234567')
    expect(other.output).toContain('MAIN_ADVANCED: main is at 1234567')
    // Started again in the same session, it doesn't report it again; under its own WATCHER_ID, it does.
    expect((await run(REPORTER, home, { CLAUDE_CODE_SESSION_ID: 'session-a' })).output).not.toContain('MAIN_ADVANCED')
    expect((await run(REPORTER, home, { CLAUDE_CODE_SESSION_ID: 'session-a', WATCHER_ID: 'subagent' })).output).toContain('MAIN_ADVANCED')
  }, 30_000)

  it("share gh's answers for a moment, so GitHub is asked once", async () => {
    const home = await stateHome()
    // A `gh` that counts its calls and answers with the count.
    const gh = `${home}/gh`
    await Bun.write(gh, `#!/bin/sh\necho x >> "${home}/calls"\nwc -l < "${home}/calls"\n`)
    await Bun.spawn(['chmod', '+x', gh]).exited
    const answers = await Promise.all(['session-a', 'session-b'].map(async id => run(ASKER, home, { CLAUDE_CODE_SESSION_ID: id, GH: gh })))
    // Both started at once may both ask; one after them takes the answer they kept.
    const later = await run(ASKER, home, { CLAUDE_CODE_SESSION_ID: 'session-c', GH: gh })
    expect(answers.map(answer => answer.code)).toEqual([0, 0])
    expect(Number(later.output)).toBeLessThanOrEqual(2)
    // `fresh` asks GitHub all the same.
    expect(Number((await run(ASKER, home, { FRESH: '1', GH: gh })).output)).toBe(Number(later.output) + 1)
  }, 30_000)
})
