import { describe, expect, it } from 'bun:test'
import { type IssuePage, allOpenIssues, goneIssueLine, isGone, isMoved, issueEventLine, issueEventsFrom, issuePage } from './watch-issue-events'

const page = (numbers: number[], endCursor: string | null) => ({ nodes: numbers.map(number => ({ number })), pageInfo: { endCursor, hasNextPage: endCursor !== null } })
const open = (numbers: number[]) => numbers.map(number => ({ blockedBy: [], number }))
const REPO = 'owner/repo'

describe('open issues (#261)', () => {
  it('reads a page of the issues connection, and the cursor of the next one', () => {
    expect(issuePage(page([1, 2], 'c1'), REPO)).toEqual({ issues: open([1, 2]), next: 'c1' })
    expect(issuePage(page([3], null), REPO)).toEqual({ issues: open([3]), next: null })
    expect(issuePage(page([], null), REPO)).toEqual({ issues: [], next: null })
  })

  it("reads each issue's blockers in the same repository, in any case, and leaves out other repositories' (#335)", () => {
    const blocker = (number: number, nameWithOwner: string) => ({ number, repository: { nameWithOwner } })
    const nodes = [{ blockedBy: { nodes: [blocker(2, 'Owner/Repo'), blocker(9, 'other/repo')] }, number: 1 }]
    expect(issuePage({ nodes, pageInfo: { endCursor: null, hasNextPage: false } }, REPO)).toEqual({ issues: [{ blockedBy: [2], number: 1 }], next: null })
  })

  it('takes an answer without a page for a failure, not for an empty list', () => {
    expect(() => issuePage({}, REPO)).toThrow()
    expect(() => issuePage({ nodes: [] }, REPO)).toThrow()
    expect(() => issuePage({ nodes: [{ number: 1 }], pageInfo: { endCursor: null, hasNextPage: true } }, REPO)).toThrow()
  })

  it('follows the cursors through a list longer than one page', async () => {
    const pages = new Map<string | null, IssuePage>([
      [null, issuePage(page(Array.from({ length: 100 }, (_item, index) => index + 1), 'c1'), REPO)],
      ['c1', issuePage(page(Array.from({ length: 74 }, (_item, index) => index + 101), null), REPO)],
    ])
    const asked: (string | null)[] = []
    const issues = await allOpenIssues(async cursor => {
      asked.push(cursor)
      return pages.get(cursor) ?? issuePage({}, REPO)
    })
    expect(asked).toEqual([null, 'c1'])
    expect(issues).toHaveLength(174)
    expect(issues.at(-1)?.number).toBe(174)
  })

  it('fails the whole list when a later page fails', async () => {
    const pages = async (cursor: string | null): Promise<IssuePage> => (cursor === null ? issuePage(page([1], 'c1'), REPO) : issuePage({}, REPO))
    await expect(allOpenIssues(pages)).rejects.toThrow()
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

describe('new issues and the owner\'s issue comments (#314)', () => {
  const people = { owner: 'someone', self: 'helper[bot]' }
  const author = (login: string) => (login.endsWith('[bot]') ? { kind: 'Bot', login: login.replaceAll('[bot]', '') } : { kind: 'User', login })
  const issue = (number: number, login: string) => ({ author: author(login), createdAt: `2026-10-0${number}T09:00:00Z`, number, title: `Issue  ${number}` })
  const comment = (databaseId: number, login: string, createdAt: string) =>
    ({ author: author(login), body: 'Do it.\nThen this.', createdAt, databaseId, url: `https://github.test/o/r/issues/1#issuecomment-${databaseId}` })
  const answer = (parts: Record<string, unknown[]>) =>
    ({ created: { nodes: parts.created ?? [] }, createdPrs: { nodes: parts.createdPrs ?? [] }, updated: { nodes: parts.updated ?? [] }, updatedPrs: { nodes: parts.updatedPrs ?? [] } })
  const later = (count: number) => Array.from({ length: count }, (_item, index) => ({ createdAt: `2026-10-06T09:${String(index).padStart(2, '0')}:00Z` }))

  it('reports new issues, not the agent\'s own, keyed by number', () => {
    expect(issueEventsFrom(answer({ created: [issue(2, 'someone'), issue(1, 'helper[bot]')] }), people))
      .toEqual([{ at: '2026-10-02T09:00:00Z', key: 'issue #2', lines: ['NEW_ISSUE #2 Issue 2'] }])
    // A PR among the newest is never a new issue, also without SELF.
    expect(issueEventsFrom(answer({ created: [issue(2, 'someone')], createdPrs: later(1) }), { owner: 'someone', self: '' })).toHaveLength(1)
  })

  it('leaves out an issue older than the fifty newest issues and PRs', () => {
    expect(issueEventsFrom(answer({ created: [issue(2, 'someone')], createdPrs: later(50) }), people)).toEqual([])
    expect(issueEventsFrom(answer({ created: [issue(2, 'someone')], createdPrs: later(49) }), people)).toHaveLength(1)
  })

  it('reports the owner\'s comments whole, with their issue, keyed by id', () => {
    const updated = [{ comments: { nodes: [comment(11, 'someone', '2026-10-05T09:00:00Z'), comment(12, 'other', '2026-10-05T10:00:00Z')] }, number: 7 }]
    expect(issueEventsFrom(answer({ updated }), people)).toEqual([
      { at: '2026-10-05T09:00:00Z', key: 'issue-comment 11', lines: ['ISSUE_COMMENT 11 #7:', '    Do it.', '    Then this.'] },
    ])
  })

  it('leaves out an owner\'s comment older than the fifty newest on issues and PRs', () => {
    const updated = [{ comments: { nodes: [comment(11, 'someone', '2026-10-05T09:00:00Z')] }, number: 7 }]
    expect(issueEventsFrom(answer({ updated, updatedPrs: [{ comments: { nodes: later(50) } }] }), people)).toEqual([])
    expect(issueEventsFrom(answer({ updated, updatedPrs: [{ comments: { nodes: later(49) } }] }), people)).toHaveLength(1)
  })
})
