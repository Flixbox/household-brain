/**
 * "Blocked by" links between GitHub issues (#256), through GitHub's issue dependencies, in any
 * repository the `gh` in use can reach. The MCP tools (mcp.ts) and the command line (cli.ts) both use
 * these, so agents set the links one way, with the deadlock check, never through raw API calls.
 */
import { type IssueRef, refKey, refOf, refText } from './refs'
import { isRecord } from './read'
import { blockingPath } from './cycle'
import { ghJson } from './gh'

const path = ({ number, repo }: IssueRef) => `repos/${repo}/issues/${number}`

/** The issue's id, which the dependency calls take instead of its number. */
const idOf = async (issue: IssueRef): Promise<number> => {
  const answer = await ghJson(['api', path(issue)])
  if (!isRecord(answer) || typeof answer.id !== 'number') {
    throw new Error(`${refText(issue)}: no such issue`)
  }
  return answer.id
}

/** The issues in a paged list (`--slurp` wraps each page in an array). */
const issuesIn = (answer: unknown): IssueRef[] =>
  (Array.isArray(answer) ? answer.flat() : []).flatMap((item: unknown) => {
    const ref = isRecord(item) ? refOf({ number: item.number, repository_url: item.repository_url }) : null
    return ref ? [ref] : []
  })

/** The issues `issue` is blocked by. */
const blockersOf = async (issue: IssueRef): Promise<IssueRef[]> => issuesIn(await ghJson(['api', '--paginate', '--slurp', `${path(issue)}/dependencies/blocked_by`]))

/** The issues `issue` blocks. */
const blockedIssuesOf = async (issue: IssueRef): Promise<IssueRef[]> => issuesIn(await ghJson(['api', '--paginate', '--slurp', `${path(issue)}/dependencies/blocking`]))

/** An issue back from its key (`owner/name#n`); GitHub takes the name in any case. */
const fromKey = (key: string): IssueRef => {
  const [repo = '', number = ''] = key.split('#')
  return { number: Number(number), repo }
}

const has = (refs: IssueRef[], wanted: IssueRef) => refs.some(known => refKey(known) === refKey(wanted))

/**
 * Marks `issue` as blocked by `blocker`. Refused, with the cycle, when `blocker` is already blocked by
 * `issue`, however indirectly: the two could then never be closed. Returns what was done.
 */
export const block = async (issue: IssueRef, blocker: IssueRef): Promise<string> => {
  if (refKey(issue) === refKey(blocker)) {
    throw new Error(`${refText(issue)} can't be blocked by itself`)
  }
  const cycle = await blockingPath(refKey(blocker), refKey(issue), async key => (await blockersOf(fromKey(key))).map(known => refKey(known)))
  if (cycle) {
    throw new Error(`refused: ${refText(issue)} blocked by ${refText(blocker)} would close a cycle: ${[refKey(issue), ...cycle].join(' → ')}`)
  }
  if (has(await blockersOf(issue), blocker)) {
    return `${refText(issue)} is already blocked by ${refText(blocker)}`
  }
  await ghJson(['api', '--method', 'POST', `${path(issue)}/dependencies/blocked_by`, '-F', `issue_id=${await idOf(blocker)}`])
  return `${refText(issue)} is now blocked by ${refText(blocker)}`
}

/** Removes the link that marks `issue` as blocked by `blocker`. */
export const unblock = async (issue: IssueRef, blocker: IssueRef): Promise<string> => {
  if (!has(await blockersOf(issue), blocker)) {
    return `${refText(issue)} isn't blocked by ${refText(blocker)}`
  }
  await ghJson(['api', '--method', 'DELETE', `${path(issue)}/dependencies/blocked_by/${await idOf(blocker)}`])
  return `${refText(issue)} is no longer blocked by ${refText(blocker)}`
}

const list = (refs: IssueRef[]) => (refs.length === 0 ? 'nothing' : refs.map(ref => refText(ref)).join(', '))

/** What blocks `issue`, and what it blocks, as lines. */
export const linksOf = async (issue: IssueRef): Promise<string> => {
  const [blockers, blocked] = await Promise.all([blockersOf(issue), blockedIssuesOf(issue)])
  return `${refText(issue)} is blocked by ${list(blockers)}; it blocks ${list(blocked)}`
}
