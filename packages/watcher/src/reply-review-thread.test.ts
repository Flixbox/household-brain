import { describe, expect, it } from 'bun:test'
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
