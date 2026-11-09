import { afterAll, describe, expect, it } from 'bun:test'
import { chmod, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { answerFrom, rateLimitWait, threadIdOf, threadsFrom } from './reply-review-thread'

const NOW = 1_800_000_000

const answer = (status: string, headers: string[], body: string) => answerFrom([status, ...headers, '', body].join('\n'))

describe('answerFrom (#297)', () => {
  it('reads the status, the headers in lower case and the JSON body', () => {
    const read = answer('HTTP/2.0 200 OK', ['X-Ratelimit-Remaining: 7067', 'Content-Type: application/json; charset=utf-8'], '{"data":{"ok":true}}')
    expect(read.status).toBe(200)
    expect(read.headers.get('x-ratelimit-remaining')).toBe('7067')
    expect(read.headers.get('content-type')).toBe('application/json; charset=utf-8')
    expect<unknown>(read.body).toEqual({ data: { ok: true } })
  })

  it('keeps a body that is no JSON as text, and an empty answer as status 0', () => {
    expect<unknown>(answer('HTTP/2.0 502 Bad Gateway', [], 'oops').body).toBe('oops')
    expect(answerFrom('').status).toBe(0)
  })
})

describe('rateLimitWait (#297)', () => {
  const limited = (headers: string[]) => answer('HTTP/2.0 403 Forbidden', headers, '{"message":"API rate limit exceeded for installation ID 1."}')

  it('waits retry-after when GitHub sends it', () => {
    expect(rateLimitWait(limited(['Retry-After: 30', 'X-Ratelimit-Remaining: 0', `X-Ratelimit-Reset: ${NOW + 600}`]), NOW)).toBe(30_000)
  })

  it('waits until the reset when nothing is left', () => {
    expect(rateLimitWait(limited(['X-Ratelimit-Remaining: 0', `X-Ratelimit-Reset: ${NOW + 90}`]), NOW)).toBe(90_000)
    expect(rateLimitWait(limited(['X-Ratelimit-Remaining: 0', `X-Ratelimit-Reset: ${NOW - 5}`]), NOW)).toBe(0)
  })

  it('waits a minute for a limit that says nothing more, as the short-window one did', () => {
    expect(rateLimitWait(limited(['X-Ratelimit-Remaining: 4200']), NOW)).toBe(60_000)
    expect(rateLimitWait(answer('HTTP/2.0 429 Too Many Requests', [], ''), NOW)).toBe(60_000)
  })

  it("takes GraphQL's RATE_LIMITED error as a limit", () => {
    expect(rateLimitWait(answer('HTTP/2.0 200 OK', [], '{"errors":[{"type":"RATE_LIMITED","message":"API rate limit exceeded"}]}'), NOW)).toBe(60_000)
  })

  it('leaves other refusals alone', () => {
    expect(rateLimitWait(answer('HTTP/2.0 403 Forbidden', [], '{"message":"Resource not accessible by integration"}'), NOW)).toBeNull()
    expect(rateLimitWait(answer('HTTP/2.0 200 OK', [], '{"errors":[{"type":"NOT_FOUND","message":"no thread"}]}'), NOW)).toBeNull()
    expect(rateLimitWait(answer('HTTP/2.0 200 OK', [], '{"data":{}}'), NOW)).toBeNull()
  })
})

describe('threadIdOf (#297)', () => {
  const threads = threadsFrom({
    nodes: [
      { comments: { nodes: [{ databaseId: 11, id: 'PRRC_a' }, { databaseId: 12, id: 'PRRC_b' }] }, id: 'PRRT_one' },
      { comments: { nodes: [{ databaseId: 21, id: 'PRRC_c' }] }, id: 'PRRT_two' },
    ],
  })

  it('reads every comment id, REST and GraphQL', () => {
    expect(threads).toEqual([{ commentIds: ['PRRC_a', '11', 'PRRC_b', '12'], id: 'PRRT_one' }, { commentIds: ['PRRC_c', '21'], id: 'PRRT_two' }])
  })

  it('finds the thread of a comment by either id, and takes a thread id as it is', () => {
    expect(threadIdOf('12', threads)).toBe('PRRT_one')
    expect(threadIdOf('PRRC_c', threads)).toBe('PRRT_two')
    expect(threadIdOf('PRRT_given', [])).toBe('PRRT_given')
  })

  it('finds none for a comment no thread holds', () => {
    expect(threadIdOf('99', threads)).toBeNull()
  })
})

describe('the gh it posts with (#532)', () => {
  const dirs: string[] = []

  afterAll(async () => {
    await Promise.all(dirs.map(async dir => rm(dir, { force: true, recursive: true })))
  })

  /** A stand-in for a `gh`: it logs its name and the repository it was told, and answers that the reply was posted. */
  const standIn = (name: string, home: string) => String.raw`#!/bin/sh
echo "${name} repo=$GH_REPO" >> "${home}/calls"
printf 'HTTP/2.0 200 OK\n\n{"data":{"addPullRequestReviewThreadReply":{"comment":{"url":"posted"}}}}\n'
`

  it('is the bot, told the repository, when GH is unset and the folder is no clone', async () => {
    const home = await mkdtemp(`${tmpdir()}/reply-review-thread-`)
    dirs.push(home)
    await Promise.all(['agent-gh', 'gh'].map(async name => {
      await Bun.write(`${home}/${name}`, standIn(name, home))
      await chmod(`${home}/${name}`, 0o755)
    }))
    const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => name !== 'GH' && name !== 'GH_REPO'))
    const child = Bun.spawn([process.execPath, `${import.meta.dir}/reply-review-thread.ts`, '7', 'PRRT_x', 'Resolved: done'], {
      cwd: home, env: { ...env, PATH: home, REPO: 'Coarisfinia/two' }, stderr: 'pipe', stdout: 'pipe',
    })
    const [output, code] = await Promise.all([new Response(child.stdout).text(), child.exited])
    expect(output.trim()).toBe('posted')
    expect(code).toBe(0)
    expect((await Bun.file(`${home}/calls`).text()).trim().split('\n')).toEqual(['agent-gh repo=Coarisfinia/two'])
  })
})
