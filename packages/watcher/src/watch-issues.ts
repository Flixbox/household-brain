/** The project watcher's issue checks (watch-project.ts): new issues, the owner's comments, closings. */
import { issueLine, openIssueNumbers } from './watch-github'
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

/** Issue lines for what was closed or reopened between `before` and `now`; null when a lookup failed. */
const issueChanges = async (before: string[], now: string[]): Promise<string[] | null> =>
  Promise.all([
    ...before.filter(issue => !now.includes(issue)).map(async issue => issueLine(Number(issue), 'closed')),
    ...now.filter(issue => !before.includes(issue)).map(async issue => issueLine(Number(issue), 'reopened')),
  ]).then(lines => lines.filter(line => line !== null), () => null)

/** Issues closed or reopened since the last round. A failed lookup leaves the state as it was, so the next round tries again. */
export const checkIssueStates = async (): Promise<void> => {
  const now = await openIssueNumbers().then(numbers => numbers.toSorted(byNumber).map(String), () => null)
  if (!now || await firstRun('open-issues', now)) {
    return
  }
  const lines = await issueChanges(await readLines('open-issues'), now)
  if (!lines) {
    return
  }
  await writeLines('open-issues', now)
  if (lines.length > 0) {
    queue(lines)
  }
}
