/** Which pull requests a round looks at (watch-main.ts). */
import { openPrs, recentlyMerged } from './watch-github'
import { readLines } from './watch-state'

const MERGED_HOURS = Number(process.env.MERGED_HOURS ?? 3)

const byNumber = (first: number, second: number) => first - second

/** Open PRs, the ones followed until their deploy, and recently merged ones; null when a listing failed. */
export const watchedPrs = async (): Promise<number[] | null> => {
  const lists = await Promise.all([
    openPrs().then(prs => prs.map(pr => pr.number)),
    recentlyMerged(MERGED_HOURS),
    readLines('tracked').then(lines => lines.map(Number)),
    readLines('reported'),
  ]).catch(() => null)
  if (!lists) {
    return null
  }
  const [open, merged, followed, reported] = lists
  // A merged PR whose deploy was reported, and that is no longer followed, needs no look: on a slow
  // `gh` each look costs seconds, all of it before the rest (#235). Only the deploy settles it: a PR
  // closed once and then reopened and merged still has its deploy to report.
  const settled = (pr: number) => reported.some(line => line.startsWith(`pr-${pr} deployed `))
  const unsettled = merged.filter(pr => followed.includes(pr) || !settled(pr))
  return [...new Set([...open, ...unsettled, ...followed])].toSorted(byNumber)
}
