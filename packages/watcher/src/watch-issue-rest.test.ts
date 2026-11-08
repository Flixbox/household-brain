import { describe, expect, it } from 'bun:test'
import { type Rest, askedSince, commentsBase, issuesBase, mergeOpen, newIssueEvents, nextPosition, ownerCommentEvents, parseSnapshot, readSince, reconcileDue } from './watch-issue-rest'

const CURSOR = '2026-11-08T12:00:00Z'
const ASKED = '2026-11-08T11:58:00Z'
const issue = (number: number, fields: Record<string, unknown> = {}) =>
  ({ created_at: '2026-11-08T12:00:30Z', number, state: 'open', title: `Issue  ${number}`, updated_at: '2026-11-08T12:00:30Z', user: { login: 'someone' }, ...fields })
const comment = (id: number, fields: Record<string, unknown> = {}) =>
  ({ body: 'Do it.', created_at: '2026-11-08T12:00:30Z', html_url: `https://github.test/o/r/issues/7#issuecomment-${id}`, id, updated_at: '2026-11-08T12:00:30Z', user: { login: 'someone' }, ...fields })

describe('the since boundary (#412)', () => {
  it('asks a little before the cursor, so an update in the cursor\'s own moment is never missed', () => {
    expect(askedSince(CURSOR)).toBe(ASKED)
    expect(askedSince('2026-11-08T12:00:00.750Z')).toBe(ASKED)
  })

  const at = (cursor: string | null, capped: string | null = null) => ({ capped, cursor })
  const stuck = [issue(1, { updated_at: CURSOR })]
  const later = (updated_at: string) => [issue(2, { updated_at })]

  it('moves the cursor to the newest update of the first page, and never back', () => {
    expect(nextPosition(at(CURSOR), [[issue(1), issue(2, { updated_at: '2026-11-08T12:05:00Z' })]])).toEqual(at('2026-11-08T12:05:00Z'))
    expect(nextPosition(at(CURSOR), [[issue(1, { updated_at: '2026-11-08T11:00:00Z' })]])).toEqual(at(CURSOR))
    expect(nextPosition(at(CURSOR), [[]])).toEqual(at(CURSOR))
    expect(nextPosition(at(null), [[]])).toEqual(at(null))
  })

  it('leaves later pages for the next round: a list that shifted while it was paged is read again', () => {
    expect(nextPosition(at(CURSOR), [[issue(1, { updated_at: '2026-11-08T12:10:00Z' })], later('2026-11-08T13:00:00Z')])).toEqual(at('2026-11-08T12:10:00Z'))
  })

  it('holds the cursor for one round after a stuck first page, so the old overlap is asked for again (#469)', () => {
    expect(nextPosition(at(CURSOR), [stuck, later('2026-11-08T12:01:00Z')])).toEqual(at(CURSOR, '2026-11-08T12:01:00Z'))
  })

  it('caps a later page at one overlap past where it has got to', () => {
    expect(nextPosition(at(CURSOR), [stuck, later('2026-11-08T13:00:00Z')])).toEqual(at(CURSOR, '2026-11-08T12:02:00Z'))
    expect(nextPosition(at(CURSOR, '2026-11-08T12:02:00Z'), [stuck, later('2026-11-08T13:00:00Z')])).toEqual(at('2026-11-08T12:02:00Z', '2026-11-08T12:04:00Z'))
  })

  it('takes the capped position once the burst is over, so nothing holds the cursor', () => {
    expect(nextPosition(at(CURSOR, '2026-11-08T12:01:00Z'), [stuck, later('2026-11-08T12:01:00Z')])).toEqual(at('2026-11-08T12:01:00Z'))
  })

  it('drops the capped position when the first page moves the cursor by itself', () => {
    expect(nextPosition(at(CURSOR, '2026-11-08T12:02:00Z'), [[issue(1, { updated_at: '2026-11-08T12:05:00Z' })]])).toEqual(at('2026-11-08T12:05:00Z'))
  })
})

describe('reading the lists (#412)', () => {
  const answering = (pages: unknown[][]) => {
    const paths: string[] = []
    const rest: Rest = async path => {
      paths.push(path)
      return pages[paths.length - 1] ?? []
    }
    return { paths, rest }
  }

  it('asks every state, oldest update first, from before the cursor', async () => {
    const { paths, rest } = answering([[issue(1)]])
    expect(await readSince(rest, issuesBase('o/r'), CURSOR)).toEqual([[issue(1)]])
    expect(paths).toEqual([`repos/o/r/issues?state=all&direction=asc&per_page=100&since=${ASKED}&sort=updated&page=1`])
  })

  it('follows a full page to the next, so nothing past the first hundred is lost', async () => {
    const full = Array.from({ length: 100 }, (_item, index) => comment(index))
    const { paths, rest } = answering([full, [comment(200)]])
    expect((await readSince(rest, commentsBase('o/r'), CURSOR)).flat()).toHaveLength(101)
    expect(paths[1]).toContain('repos/o/r/issues/comments?direction=asc')
    expect(paths[1]).toContain('&page=2')
  })

  it('reads one page of the newest on the very first look, with no cursor', async () => {
    const { paths, rest } = answering([Array.from({ length: 100 }, (_item, index) => issue(index))])
    await readSince(rest, issuesBase('o/r'), null)
    expect(paths).toEqual(['repos/o/r/issues?state=all&direction=desc&per_page=100&sort=updated&page=1'])
  })

  it('takes an answer that is no list for a failure, not for no news', async () => {
    await expect(readSince(async () => ({ message: 'no' }), issuesBase('o/r'), CURSOR)).rejects.toThrow()
  })
})

describe('what is news (#412)', () => {
  it('reports a new issue, not a pull request, not the agent\'s own, keyed as before', () => {
    const items = [issue(9), issue(8, { pull_request: { url: 'x' } }), issue(7, { user: { login: 'helper[bot]' } })]
    expect(newIssueEvents(items, 'helper[bot]', CURSOR)).toEqual([{ at: '2026-11-08T12:00:30Z', issue: 9, key: 'issue #9', lines: ['NEW_ISSUE #9 Issue 9'] }])
  })

  it('does not report an old issue that only now came up, and does report one written just before the cursor', () => {
    expect(newIssueEvents([issue(5, { created_at: '2026-10-01T09:00:00Z' })], '', CURSOR)).toEqual([])
    expect(newIssueEvents([issue(5, { created_at: '2026-11-08T11:59:59Z' })], '', CURSOR)).toHaveLength(1)
  })

  it('takes all it finds on the first look, for it to be stored as old news', () => {
    expect(newIssueEvents([issue(5, { created_at: '2026-10-01T09:00:00Z' })], '', null)).toHaveLength(1)
  })

  it('reports the owner\'s comments on issues, whole and keyed by id, and none on a pull request', () => {
    const items = [comment(11), comment(12, { user: { login: 'other' } }), comment(13, { html_url: 'https://github.test/o/r/pull/7#issuecomment-13' })]
    expect(ownerCommentEvents(items, 'someone', CURSOR)).toEqual([
      { at: '2026-11-08T12:00:30Z', issue: 7, key: 'issue-comment 11', lines: ['ISSUE_COMMENT 11 #7:', '    Do it.'] },
    ])
  })

  it('does not report an old comment that was only edited', () => {
    expect(ownerCommentEvents([comment(11, { created_at: '2026-10-01T09:00:00Z' })], 'someone', CURSOR)).toEqual([])
  })
})

describe('the open list (#412)', () => {
  const known = [{ blockedBy: [2], number: 1 }, { blockedBy: [], number: 2 }]

  it('drops what closed, adds what opened, and keeps the blockers it knows', () => {
    expect(mergeOpen(known, [issue(2, { state: 'closed' }), issue(3)])).toEqual([{ blockedBy: [2], number: 1 }, { blockedBy: [], number: 3 }])
    expect(mergeOpen(known, [issue(1, { title: 'edited' })])).toEqual(known)
  })

  it('ignores pull requests', () => {
    expect(mergeOpen(known, [issue(9, { pull_request: {} })])).toEqual(known)
  })

  it('reads a stored snapshot, and takes a damaged one for none', () => {
    const snapshot = { capped: '2026-11-08T12:02:00Z', cursor: CURSOR, fullAt: 5, issues: known }
    expect(parseSnapshot(JSON.stringify(snapshot))).toEqual(snapshot)
    expect(parseSnapshot(JSON.stringify({ cursor: CURSOR, fullAt: 5, issues: known }))).toEqual({ capped: null, cursor: CURSOR, fullAt: 5, issues: known })
    expect(parseSnapshot('{')).toBeNull()
    expect(parseSnapshot('{"cursor":1}')).toBeNull()
    expect(parseSnapshot(null)).toBeNull()
  })

  it('reads the whole list again after a while, for deletions and blockers no update shows', () => {
    expect(reconcileDue({ capped: null, cursor: CURSOR, fullAt: 1000, issues: [] }, 1000 + 14 * 60_000)).toBe(false)
    expect(reconcileDue({ capped: null, cursor: CURSOR, fullAt: 1000, issues: [] }, 1000 + 15 * 60_000)).toBe(true)
  })
})
