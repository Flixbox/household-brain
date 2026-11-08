/**
 * The open issues (#412): one full read, then `since=` merged into it, kept in `open-issue-snapshot`,
 * so a restart goes on where it stopped. A full read comes back every so often (see `reconcileDue`).
 */
import { type IssueSnapshot, type Rest, issuesBase, mergeOpen, nextPosition, parseSnapshot, readSince, reconcileDue } from './watch-issue-rest'
import type { OpenIssue } from './watch-link-cycles'
import { REPO, openIssues } from './watch-github'
import { ghRest } from './watch-gh'
import { readLines, writeLines } from './watch-state'

const FILE = 'open-issue-snapshot'
const rest: Rest = async path => ghRest(path)
const BASE = issuesBase(REPO)
const nowMs = () => Temporal.Now.instant().epochMilliseconds

const stored = async (snapshot: IssueSnapshot): Promise<OpenIssue[]> => {
  await writeLines(FILE, [JSON.stringify(snapshot)])
  return snapshot.issues
}

/**
 * The whole list. The cursor comes from GitHub's own newest update, asked for before the list, so
 * what changes during the read comes again; it isn't this machine's clock. An empty list counts as
 * a failed read (#261), and isn't kept.
 */
const fullRead = async (previous: IssueSnapshot | null): Promise<OpenIssue[] | null> => {
  const cursor = previous?.cursor ?? nextPosition({ capped: null, cursor: null }, await readSince(rest, BASE, null)).cursor
  const fullAt = nowMs()
  const issues = await openIssues()
  return issues.length === 0 ? null : stored({ capped: previous?.capped ?? null, cursor, fullAt, issues })
}

/** Every open issue with its blockers; null when the list couldn't be read. */
export const currentOpenIssues = async (): Promise<OpenIssue[] | null> => {
  const snapshot = parseSnapshot((await readLines(FILE))[0] ?? null)
  if (typeof snapshot?.cursor !== 'string' || reconcileDue(snapshot, nowMs())) {
    return fullRead(snapshot)
  }
  const pages = await readSince(rest, BASE, snapshot.cursor)
  return stored({ ...snapshot, ...nextPosition(snapshot, pages), issues: mergeOpen(snapshot.issues, pages.flat()) })
}
