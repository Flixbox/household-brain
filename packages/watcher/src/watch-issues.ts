/** The project watcher's issue checks (watch-project.ts): new issues, the owner's comments, closings, cycles in their links. */
import { MAX_CYCLES, type OpenIssue, linkCycles, newCycles } from './watch-link-cycles'
import { graphql, issueLine, openIssues } from './watch-github'
import { at } from './watch-text'
import type { IssueEvent } from './watch-issue-events'
import { issueEventLines, subscribedIssueEvents } from './watch-comments'
import { queue } from './watch-output'
import { appendLines, endIssue, exists, oneAtATime, readLines, subscriptions, writeLines } from './watch-state'

const byNumber = (first: number, second: number) => first - second

/** On the very first run, a state file starts from what is there now: none of it is news. */
const firstRun = async (name: string, lines: string[]): Promise<boolean> => {
  if (await exists(name)) {
    return false
  }
  await writeLines(name, lines)
  return true
}

/**
 * A scoped watcher reads only its subscribed issues' comments (#357), and remembers them in a file of
 * its own: the repository-wide reads before it never saw an issue's older comments, which would
 * otherwise all come up as news once.
 */
const SEEN_FILE = subscriptions.scoped ? 'subscribed-issue-events' : 'issue-events'
const issueEvents = async (fresh: boolean): Promise<IssueEvent[]> =>
  subscriptions.scoped ? subscribedIssueEvents(subscriptions.issues, fresh) : issueEventLines(fresh)

const unseenIssues = async (lines: IssueEvent[]): Promise<IssueEvent[]> => {
  const seen = new Set(await readLines(SEEN_FILE))
  const unseen = lines.filter(({ key }) => !seen.has(key))
  await appendLines(SEEN_FILE, unseen.map(({ key }) => key))
  return unseen
}

/** Issues and the owner's comments on them not reported yet; the ones from before the first run aren't news. */
export const checkIssues = async (fresh = false): Promise<boolean> => oneAtATime('issue-activity', async () => {
  const lines = await issueEvents(fresh).catch(() => null)
  // A new state file for the id keys (#247): on its first run what is there is old news, so nothing
  // already reported under the old text keys (`issues`) comes back.
  if (!lines) { return false }
  if (await firstRun(SEEN_FILE, lines.map(({ key }) => key))) { return true }
  const unseen = await unseenIssues(lines)
  // Each its own event, with when it was written (#240): several comments are several answers.
  for (const { at: written, issue, key, lines: event } of unseen) {
    queue(event, { issue, key: `issue:${key}`, written })
  }
  return true
})

/**
 * Issue lines for what was closed or reopened between `before` and `now`; null when a lookup failed.
 * An issue that is gone (deleted or transferred) doesn't fail it (#263): it would fail every round.
 */
const issueChanges = async (before: string[], now: string[]): Promise<{ closed: boolean, issue: number, line: string }[] | null> =>
  Promise.all([
    ...before.filter(issue => !now.includes(issue)).map(async issue => ({ closed: true, issue: Number(issue), line: await issueLine(Number(issue), 'closed') })),
    ...now.filter(issue => !before.includes(issue)).map(async issue => ({ closed: false, issue: Number(issue), line: await issueLine(Number(issue), 'reopened') })),
  ]).then(lines => lines.flatMap(item => item.line === null ? [] : [{ closed: item.closed, issue: item.issue, line: item.line }]), () => null)

/**
 * Cycles in the blocked-by links between open issues that weren't there on the last look (#335),
 * one LINK_CYCLE line each. Unlike other news, a cycle there before the first look is reported too:
 * it holds its issues up until someone unblocks a link.
 */
const checkLinkCycles = async (issues: readonly OpenIssue[]): Promise<void> => {
  const now = linkCycles(issues)
  const fresh = newCycles(await readLines('link-cycles'), now)
  await writeLines('link-cycles', now)
  if (fresh.length > 0) {
    // At the cap, more cycles may hide behind these; they come as news once these are fixed.
    const more = now.length >= MAX_CYCLES ? [`(at least ${MAX_CYCLES} cycles; more may come once these are fixed: run issue-links audit)`] : []
    queue([...fresh.map(cycle => `LINK_CYCLE ${cycle}`), ...more])
  }
}

/** Issues closed or reopened since the open list `now` was last stored; the first list is stored as it is. */
const checkOpenList = async (now: string[]): Promise<void> => {
  if (await firstRun('open-issues', now)) {
    return
  }
  const before = await readLines('open-issues')
  const lines = before.length === 0 ? [] : await issueChanges(before, now)
  if (!lines) {
    return
  }
  await writeLines('open-issues', now)
  for (const { issue, line } of lines) {
    queue([line], { issue })
  }
}

/**
 * Issues closed or reopened since the last round, and new cycles in their links. A failed lookup
 * leaves the state as it was, so the next round tries again; a gone issue isn't a failed lookup
 * (#263). An empty list counts as a failed one, and an empty stored list as none (#261): compared
 * with either, every issue would look closed or reopened.
 */
export const checkIssueStates = async (): Promise<void> => {
  // A scoped watcher reports no cycles and no other issue's closing (#357), and its own issues'
  // closings come from `checkSubscribedIssues`: the open list is not its question.
  if (subscriptions.scoped) {
    return
  }
  const issues = await openIssues().catch(() => null)
  if (!issues || issues.length === 0) {
    return
  }
  await checkLinkCycles(issues)
  await checkOpenList(issues.map(({ number }) => number).toSorted(byNumber).map(String))
}

export const checkSubscribedIssues = async (): Promise<void> => {
  const { issues } = subscriptions
  if (issues.length === 0) { return }
  const value = await graphql(issues.map(issue => `issue${issue}:issue(number:${issue}){state}`).join(' '))
  const closed = issues.filter(issue => at(value, `issue${issue}`, 'state') === 'CLOSED')
  // A failed final activity lookup cannot close a subscription or discard an owner's comment.
  if (closed.length === 0 || !await checkIssues(true)) { return }
  await Promise.all(closed.map(async issue => {
    queue([`ISSUE_CLOSED #${issue}: subscription completed`], { issue, key: `subscription-issue-closed:${issue}` })
    await endIssue(issue)
  }))
}
