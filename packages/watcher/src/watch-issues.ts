/** The project watcher's issue checks (watch-project.ts): new issues, the owner's comments, closings. */
import { issueKey } from './watch-events'
import { issueEventLines, issueLine, openIssueNumbers } from './watch-github'
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
  if (!lines || await firstRun('issues', lines.map(item => issueKey(item)))) {
    return
  }
  const seen = new Set(await readLines('issues'))
  const fresh = lines.filter(line => !seen.has(issueKey(line)))
  if (fresh.length > 0) {
    await appendLines('issues', fresh.map(item => issueKey(item)))
    queue(fresh)
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
