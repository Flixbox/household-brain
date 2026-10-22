import { describe, expect, it } from 'bun:test'
import { ghText, lookupNews, lookups } from './watch-gh'
import { ignoreFailure } from './read'

const NOW = Temporal.Instant.from('2026-10-18T07:31:00Z')
const minutesAgo = (minutes: number) => NOW.subtract({ minutes })

describe('lookupNews (#253)', () => {
  it('says nothing while calls succeed', () => {
    expect(lookupNews({ failing: false, lastFailure: 'exit 1', lastSuccess: minutesAgo(1) }, NOW, '07:30')).toEqual({ failing: false, line: null })
  })

  it('says on every look that no call has succeeded for minutes, with the latest failure', () => {
    const news = lookupNews({ failing: true, lastFailure: 'timed out after 30 s', lastSuccess: minutesAgo(330) }, NOW, '01:49')
    expect(news.failing).toBe(true)
    expect(news.line).toBe('LOOKUPS_FAILING: no gh call has succeeded since 01:49 (the latest: timed out after 30 s); nothing can be reported until one does')
  })

  it('says once that calls succeed again', () => {
    expect(lookupNews({ failing: true, lastFailure: 'exit 1', lastSuccess: minutesAgo(0) }, NOW, '07:31')).toEqual({ failing: false, line: 'LOOKUPS_RECOVERED: gh calls succeed again' })
  })
})

describe('ghText keeping track of the calls (#253)', () => {
  it('records a success, a failed call and one that could not start', async () => {
    const before = lookups.lastSuccess
    // Fresh: a shared answer would be kept with the real watchers' (#264), and needs no call.
    await ghText([], 'true', true)
    expect(Temporal.Instant.compare(lookups.lastSuccess, before)).toBeGreaterThanOrEqual(0)
    await expect(ghText([], 'false', true)).rejects.toThrow('exit 1')
    expect(lookups.lastFailure).toBe('exit 1')
    // The failure is what is tested here, through `lookups`; the error itself is not.
    await ghText([], 'no-such-gh-anywhere', true).catch(ignoreFailure)
    expect(lookups.lastFailure).toBe("no-such-gh-anywhere couldn't be started")
  })
})
