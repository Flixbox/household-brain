/* oxlint-disable import/no-nodejs-modules -- a temporary folder for each test's fake gh and its calls */
import { afterEach, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'

const dirs: string[] = []
afterEach(async () => { await Promise.all(dirs.splice(0).map(async dir => rm(dir, { force: true, recursive: true }))) })

/**
 * A `gh` that answers REST as `gh api -i` does: headers, a blank line, the body. Its ETag follows the
 * file `version`, and like the real one it prints a 304's headers and exits 1. FAIL makes it refuse.
 */
const FAKE_GH = String.raw`
  import { appendFileSync, existsSync, readFileSync } from 'node:fs'
  const args = process.argv.slice(2)
  const text = args.join(' ')
  const home = process.env.FIXTURE_HOME
  appendFileSync(home + '/calls', text + '\n')
  if (!text.startsWith('api -i')) { console.log(text.includes('graphql') ? '' : '[]'); process.exit(text.includes('graphql') ? 0 : 1) }
  if (existsSync(home + '/refuse')) { process.stdout.write('HTTP/2.0 500 Server Error\r\n\r\n{"message":"no"}'); process.exit(1) }
  const version = readFileSync(home + '/version', 'utf8').trim()
  const etag = 'W/"' + version + '"'
  if (args.includes('If-None-Match: ' + etag)) { process.stdout.write('HTTP/2.0 304 Not Modified\r\nEtag: ' + etag + '\r\n\r\n'); process.exit(1) }
  const now = Temporal.Now.instant().toString()
  const body = text.includes('state=open') ? [{ number: 7 }, { number: Number(version) }]
    : text.includes('state=closed') ? [{ merged_at: now, number: 3 }, { merged_at: null, number: 4 }, { merged_at: '2020-01-01T00:00:00Z', number: 5 }]
    : text.includes('head_sha=abc') ? { workflow_runs: [{ conclusion: 'success', id: 11, run_attempt: 2, run_started_at: now, status: 'completed' }] }
    : text.includes('head_sha=') ? { workflow_runs: [] }
    : { commit: { message: 'subject\n\nbody' }, sha: 'main1' }
  process.stdout.write('HTTP/2.0 200 OK\r\nEtag: ' + etag + '\r\n\r\n' + JSON.stringify(body))
`

const fixture = async () => {
  const home = await mkdtemp(`${tmpdir()}/watch-rest-`)
  dirs.push(home)
  await Bun.write(`${home}/fake.ts`, FAKE_GH)
  await Bun.write(`${home}/gh`, `#!/bin/sh\nexec "${process.execPath}" "${home}/fake.ts" "$@"\n`)
  await Bun.spawn(['chmod', '+x', `${home}/gh`]).exited
  await Bun.write(`${home}/version`, '8')
  return home
}

/** Runs `body` in its own process with `watch-github` as `github`; it prints what the test compares. */
const inWatcher = async (home: string, body: string, env: Record<string, string> = {}) => {
  const script = `const github = await import('${import.meta.dir}/watch-github')\n${body}`
  const child = Bun.spawn([process.execPath, '-e', script], {
    env: { ...process.env, FIXTURE_HOME: home, GH: `${home}/gh`, GH_SHARE_SECONDS: '0', GH_TOKEN: 'token-a', GITHUB_TOKEN: '', OWNER: 'owner', REPO: 'owner/repo', XDG_STATE_HOME: home, ...env },
    stderr: 'pipe',
    stdout: 'pipe',
  })
  const [output, error, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
  expect({ code, error }).toEqual({ code: 0, error: '' })
  return output.trim()
}

const restCalls = async (home: string) => (await Bun.file(`${home}/calls`).text()).split('\n').filter(call => call.startsWith('api -i'))
const OPEN = 'console.log(JSON.stringify(await github.openPrNumbers()))'

test('an unchanged list is asked for with its ETag, and a 304 gives the kept answer (#405)', async () => {
  const home = await fixture()
  expect(await inWatcher(home, OPEN)).toBe('[7,8]')
  expect(await inWatcher(home, OPEN)).toBe('[7,8]')
  const calls = await restCalls(home)
  expect(calls).toHaveLength(2)
  expect(calls[0]).toContain('repos/owner/repo/pulls?state=open')
  expect(calls[0]).not.toContain('If-None-Match')
  expect(calls[1]).toContain('If-None-Match: W/"8"')
})

test('a 304 counts as a lookup that succeeded, so it can\'t feed LOOKUPS_FAILING (#405)', async () => {
  const home = await fixture()
  const script = `
    const { lookups } = await import('${import.meta.dir}/watch-gh')
    await github.openPrNumbers()
    lookups.lastSuccess = Temporal.Instant.from('2020-01-01T00:00:00Z')
    await github.openPrNumbers()
    console.log(JSON.stringify([lookups.lastFailure, lookups.lastSuccess.toString() > '2021']))`
  expect(await inWatcher(home, script)).toBe('["",true]')
})

test('a changed list is read anew and kept under its new ETag (#405)', async () => {
  const home = await fixture()
  await inWatcher(home, OPEN)
  await Bun.write(`${home}/version`, '9')
  expect(await inWatcher(home, OPEN)).toBe('[7,9]')
  expect(await inWatcher(home, OPEN)).toBe('[7,9]')
  expect((await restCalls(home))[2]).toContain('If-None-Match: W/"9"')
})

test('ETags are kept per token and per URL (#405)', async () => {
  const home = await fixture()
  await inWatcher(home, OPEN)
  await inWatcher(home, OPEN, { GH_TOKEN: 'token-b' })
  await inWatcher(home, 'console.log(JSON.stringify(await github.mainHead()))', { GH_TOKEN: 'token-a' })
  const calls = await restCalls(home)
  expect(calls.filter(call => call.includes('If-None-Match'))).toEqual([])
  expect(calls[2]).toContain('repos/owner/repo/commits/main')
})

test('a refused request fails, even with an answer kept (#405)', async () => {
  const home = await fixture()
  await inWatcher(home, OPEN)
  await Bun.write(`${home}/refuse`, '')
  expect(await inWatcher(home, 'console.log(await github.openPrNumbers().then(() => "read", () => "failed"))')).toBe('failed')
})

test('the merged list, a commit\'s run and main\'s head read the REST answers (#405)', async () => {
  const home = await fixture()
  expect(await inWatcher(home, 'console.log(JSON.stringify(await github.recentlyMerged(24)))')).toBe('[3]')
  const run: unknown = JSON.parse(await inWatcher(home, 'console.log(JSON.stringify(await github.runOf("abc")))'))
  expect(run).toMatchObject({ attempt: 2, conclusion: 'success', id: 11, status: 'completed' })
  expect(await inWatcher(home, 'console.log(JSON.stringify(await github.runOf("none")))')).toBe('null')
  expect(await inWatcher(home, 'console.log(JSON.stringify(await github.mainHead()))')).toBe('{"sha":"main1","subject":"subject"}')
  expect((await restCalls(home)).find(call => call.includes('head_sha=abc'))).toContain('repos/owner/repo/actions/workflows/ci.yml/runs?')
})
