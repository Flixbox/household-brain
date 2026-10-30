/** The project watcher's issue checks (watch-project.ts): new issues, the owner's comments, closings, cycles in their links. */
import { MAX_CYCLES, type OpenIssue, linkCycles, newCycles } from './watch-link-cycles'
import { issueLine, openIssues } from './watch-github'
import { issueEventLines } from './watch-comments'
import { queue } from './watch-output'
import { appendLines, exists, readLines, writeLines } from './watch-state'

const byNumber = (first: number, second: number) => first - second

/** On the very first run, a state file starts from what is there now: none of it is news. */
const firstRun = async (name: string, lines: string[]): Promise<boolean> => {
  if (await exists(name)) {
    return false
  }
  await writeLines(name, lines)
  return true
}

/** Issues and the owner's comments on them not reported yet; the ones from before the first run aren't news. */
export const checkIssues = async (): Promise<void> => {
  const lines = await issueEventLines().catch(() => null)
  // A new state file for the id keys (#247): on its first run what is there is old news, so nothing
  // already reported under the old text keys (`issues`) comes back.
  if (!lines || await firstRun('issue-events', lines.map(({ key }) => key))) {
    return
  }
  const seen = new Set(await readLines('issue-events'))
  const fresh = lines.filter(({ key }) => !seen.has(key))
  await appendLines('issue-events', fresh.map(({ key }) => key))
  // Each its own event, with when it was written (#240): several comments are several answers.
  for (const { at, lines: event } of fresh) {
    queue(event, at)
  }
}

/**
 * Issue lines for what was closed or reopened between `before` and `now`; null when a lookup failed.
 * An issue that is gone (deleted or transferred) doesn't fail it (#263): it would fail every round.
 */
const issueChanges = async (before: string[], now: string[]): Promise<string[] | null> =>
  Promise.all([
    ...before.filter(issue => !now.includes(issue)).map(async issue => issueLine(Number(issue), 'closed')),
    ...now.filter(issue => !before.includes(issue)).map(async issue => issueLine(Number(issue), 'reopened')),
  ]).then(lines => lines.filter(line => line !== null), () => null)

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

/**
 * Issues closed or reopened since the last round, and new cycles in their links. A failed lookup
 * leaves the state as it was, so the next round tries again; a gone issue isn't a failed lookup
 * (#263). An empty list counts as a failed one, and an empty stored list as none (#261): compared
 * with either, every issue would look closed or reopened.
 */
export const checkIssueStates = async (): Promise<void> => {
  const issues = await openIssues().catch(() => null)
  if (!issues || issues.length === 0) {
    return
  }
  await checkLinkCycles(issues)
  const now = issues.map(({ number }) => number).toSorted(byNumber).map(String)
  if (await firstRun('open-issues', now)) {
    return
  }
  const before = await readLines('open-issues')
  const lines = before.length === 0 ? [] : await issueChanges(before, now)
  if (!lines) {
    return
  }
  await writeLines('open-issues', now)
  if (lines.length > 0) {
    queue(lines)
  }
}
