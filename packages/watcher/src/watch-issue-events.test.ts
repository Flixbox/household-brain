import { describe, expect, it } from 'bun:test'
import { type IssuePage, allIssueNumbers, goneIssueLine, isGone, isMoved, issueEventLine, issuePage } from './watch-issue-events'

const page = (numbers: number[], endCursor: string | null) => ({ nodes: numbers.map(number => ({ number })), pageInfo: { endCursor, hasNextPage: endCursor !== null } })

describe('open issues (#261)', () => {
  it('reads a page of the issues connection, and the cursor of the next one', () => {
    expect(issuePage(page([1, 2], 'c1'))).toEqual({ next: 'c1', numbers: [1, 2] })
    expect(issuePage(page([3], null))).toEqual({ next: null, numbers: [3] })
    expect(issuePage(page([], null))).toEqual({ next: null, numbers: [] })
  })

  it('takes an answer without a page for a failure, not for an empty list', () => {
    expect(() => issuePage({})).toThrow()
    expect(() => issuePage({ nodes: [] })).toThrow()
    expect(() => issuePage({ nodes: [{ number: 1 }], pageInfo: { endCursor: null, hasNextPage: true } })).toThrow()
  })

  it('follows the cursors through a list longer than one page', async () => {
    const pages = new Map<string | null, IssuePage>([
      [null, issuePage(page(Array.from({ length: 100 }, (_item, index) => index + 1), 'c1'))],
      ['c1', issuePage(page(Array.from({ length: 74 }, (_item, index) => index + 101), null))],
    ])
    const asked: (string | null)[] = []
    const numbers = await allIssueNumbers(async cursor => {
      asked.push(cursor)
      return pages.get(cursor) ?? issuePage({})
    })
    expect(asked).toEqual([null, 'c1'])
    expect(numbers).toHaveLength(174)
    expect(numbers.at(-1)).toBe(174)
  })

  it('fails the whole list when a later page fails', async () => {
    const pages = async (cursor: string | null): Promise<IssuePage> => (cursor === null ? issuePage(page([1], 'c1')) : issuePage({}))
    await expect(allIssueNumbers(pages)).rejects.toThrow()
  })
})

describe('issueEventLine', () => {
  it('reports a closed issue, with why and by whom', () => {
    expect(issueEventLine(7, { closed_by: { login: 'someone' }, state: 'closed', state_reason: 'completed', title: 'Fix it' }, 'closed'))
      .toBe('ISSUE_CLOSED #7 Fix it (completed, by someone)')
  })

  it('does not report an open issue as closed (#261)', () => {
    expect(issueEventLine(7, { closed_at: null, closed_by: null, state: 'open', state_reason: null, title: 'Fix it' }, 'closed')).toBeNull()
    expect(issueEventLine(7, {}, 'closed')).toBeNull()
  })

  it('reports a reopened issue, and not a brand-new one', () => {
    expect(issueEventLine(7, { closed_at: '2026-10-01T09:00:00Z', state: 'open', title: 'Fix it' }, 'reopened')).toBe('ISSUE_REOPENED #7 Fix it')
    expect(issueEventLine(7, { closed_at: null, state: 'open', state_reason: null, title: 'Fix it' }, 'reopened')).toBeNull()
  })
})

describe('an issue that is gone (#263)', () => {
  it('takes a deleted or unseen issue for gone, and any other failure for a passing one', () => {
    expect(isGone(404)).toBe(true)
    expect(isGone(410)).toBe(true)
    expect(isGone(403)).toBe(false)
    expect(isGone(502)).toBe(false)
    expect(isGone(null)).toBe(false)
  })

  it('sees an issue GitHub answered from another repository as moved', () => {
    expect(isMoved({ repository_url: 'https://api.github.com/repos/someone/things' }, 'someone/things')).toBe(false)
    expect(isMoved({ repository_url: 'https://api.github.com/repos/Someone/Things' }, 'someone/things')).toBe(false)
    expect(isMoved({ repository_url: 'https://api.github.com/repos/someone/other-things' }, 'someone/things')).toBe(true)
  })

  it('reports a gone issue that left the open list as closed, and not one that joined it', () => {
    expect(goneIssueLine(7, 'closed')).toBe('ISSUE_CLOSED #7 (deleted or transferred)')
    expect(goneIssueLine(7, 'reopened')).toBeNull()
  })
})
