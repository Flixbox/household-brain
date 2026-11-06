/** The project watcher's look at a pull request's comments and reviews (watch-project.ts), and which pull requests a round looks at. */
import { type Activity, newActivity } from './watch-events'
import { ACTIVITY_FIELDS, activityFrom } from './watch-comment-lines'
import { ACTIVITY_GH, IGNORED, OWNER, SELF, graphql, openPrNumbers, perPr, recentlyMerged } from './watch-github'
import { at, count, records } from './watch-text'
import { appendLines, exists, oneAtATime, readLines, subscriptions, writeLines } from './watch-state'
import { allSettled } from './read'
import { queue } from './watch-output'

/**
 * Comments, reviews (not plain approvals, each with its line comments) and review comments on each PR
 * asked about, the agent's own left out (see `activityFrom`). Read through GraphQL (#306), twenty PRs to
 * a query, so a reviewed PR's hundred reviews of a hundred line comments each stay within GitHub's
 * limits; a PR that couldn't be read is missing.
 */
export const activitiesOf = async (prs: readonly number[], fresh = false): Promise<Map<number, Activity[]>> =>
  perPr(prs, { cli: ACTIVITY_GH, fields: ACTIVITY_FIELDS, fresh, parse: value => activityFrom(value, { ignored: IGNORED, owner: OWNER, self: SELF }), size: 20 })

/** The comments of a PR already reported. On the very first round, the ones already there are old news. */
const seenActivity = async (pr: number, items: Activity[]): Promise<Set<string>> => {
  const seenFile = `pr-${pr}-seen`
  // A PR that appears later is new, and so is everything on it, also what came between its NEW_PR
  // and this look (#122).
  if (!await exists(seenFile)) {
    await writeLines(seenFile, await exists('initialized') ? [] : items.map(item => item.id))
  }
  return new Set(await readLines(seenFile))
}

/**
 * New comments and reviews on a PR, from its `items` read this look (`activitiesOf`); false when they
 * couldn't be read (`undefined`: tried again next round). One look per PR at a time: both pollers ask
 * (#240), and two at once would report the same comment twice.
 */
export const checkActivity = async (pr: number, items: Activity[] | undefined): Promise<boolean> => oneAtATime(`activity ${pr}`, async () => {
  if (!items) {
    return false
  }
  const fresh = newActivity(await seenActivity(pr, items), items)
  if (fresh.length > 0) {
    await appendLines(`pr-${pr}-seen`, fresh.map(item => item.id))
    queue([`PR #${pr}: ACTIVITY:`, ...fresh.flatMap(item => item.lines)], { key: `activity:${pr}:${fresh.map(item => item.id).join(',')}`, pr })
  }
  return true
})

/** The comments on every PR followed, on their own: the owner's answers mustn't wait for CI and deploys (#240). */
export const checkTrackedActivity = async (): Promise<void> => {
  const prs = (await readLines('tracked')).map(Number)
  const activities = await activitiesOf(prs)
  await allSettled(prs.map(async pr => checkActivity(pr, activities.get(pr))))
}

const MERGED_HOURS = Number(process.env.MERGED_HOURS ?? 3)

const byNumber = (first: number, second: number) => first - second

/**
 * The open PRs whose closing references name one of `issues` (#357), in one query, without listing
 * every open PR. GitHub's list also holds the merged ones, which closed the issue once before it was
 * reopened: not this subscription's news. A linked PR that merges now stays followed (`tracked`).
 */
const closingPrs = async (issues: readonly number[]): Promise<number[]> => {
  if (issues.length === 0) {
    return []
  }
  const repository = await graphql(issues.map(issue => `issue${issue}: issue(number:${issue}){closedByPullRequestsReferences(first:20){nodes{number state}}}`).join(' '))
  return issues.flatMap(issue => records(at(repository, `issue${issue}`, 'closedByPullRequestsReferences', 'nodes'))
    .filter(pr => pr.state === 'OPEN').map(pr => count(pr.number)))
}

/**
 * A scoped watcher's PRs (#357): the subscribed ones, the open ones closing a subscribed issue, and the
 * ones it follows already (a linked PR that merged stays followed until its merge is reported). It
 * never lists the repository's PRs: every watcher asking about every PR ran out the app's GraphQL
 * points. Null when the lookup failed.
 */
const subscribedPrs = async (): Promise<number[] | null> => {
  const lists = await Promise.all([closingPrs(subscriptions.issues), readLines('tracked').then(lines => lines.map(Number))]).catch(() => null)
  if (!lists) {
    return null
  }
  const [linked, followed] = lists
  return [...new Set([...subscriptions.prs, ...linked, ...followed])].filter(pr => !subscriptions.isClosedPr(pr) || linked.includes(pr)).toSorted(byNumber)
}

/** Open PRs, the ones followed until their deploy, and recently merged ones; null when a listing failed. */
export const watchedPrs = async (): Promise<number[] | null> => {
  if (subscriptions.scoped) {
    return subscribedPrs()
  }
  const lists = await Promise.all([
    openPrNumbers(),
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
