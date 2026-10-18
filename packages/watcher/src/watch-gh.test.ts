import { describe, expect, it } from 'bun:test'
import { lookupNews } from './watch-gh'

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
