/** The project watcher's look at a pull request's comments and reviews (watch-project.ts), and which pull requests a round looks at. */
import { type Activity, newActivity } from './watch-events'
import { ACTIVITY_FIELDS, PENDING_FIELDS, activityFrom, addPending } from './watch-comment-lines'
import { GH } from './watch-gh'
import { changeTracker } from './watch-change-gate'
import { ACTIVITY_GH, IGNORED, OWNER, SELF, openPrNumbers, perPr, recentlyMerged } from './watch-github'
import { type Json, at, count, records } from './watch-text'
import { perIssue } from './watch-per-issue'
import { exists, oneAtATime, readLines, subscribedSince, subscriptions, writeLines } from './watch-state'
import { allSettled, hasText, textOf } from './read'
import { isUnwritten, markSeen, queue, reportedLines } from './watch-output'

export { changedStates } from './watch-change-gate'

const parseActivity = (value: Json): Activity[] => activityFrom(value, { ignored: IGNORED, owner: OWNER, self: SELF })

/** Everything on `prs` as `cli` sees it, twenty PRs to a query: a reviewed PR's hundred reviews of a hundred line comments each stay within GitHub's limits. */
const allActivity = async (prs: readonly number[], cli: string, fresh: boolean) => perPr(prs, { cli, fields: ACTIVITY_FIELDS, fresh, parse: parseActivity, size: 20 })

/**
 * Comments, reviews (not plain approvals, each with its line comments) and review comments on each PR
 * asked about, the agent's own left out (see `activityFrom`), through GraphQL (#306). `GH` reads them,
 * and `ACTIVITY_GH` adds only its pending review, the one thing `GH` can't see (#403); a refused check
 * holds nothing back, as the pending review just comes a look later, except on a `fresh` read, the
 * last before a subscription ends: there the PR counts as unread, to be tried again. A PR `GH` couldn't read goes to
 * `ACTIVITY_GH` whole, so the owner's comments still arrive while the bot is out of points. A PR that
 * neither could read is missing.
 */
export const activitiesOf = async (prs: readonly number[], fresh = false, needsPending = fresh): Promise<Map<number, Activity[]>> => {
  if (GH === ACTIVITY_GH) {
    return allActivity(prs, GH, fresh)
  }
  // Pending first: a review submitted between the two reads is then in the second, and in neither the other way round.
  const pending = await perPr(prs, { cli: ACTIVITY_GH, fields: PENDING_FIELDS, fresh, parse: parseActivity, size: 50 })
  const read = await allActivity(prs, GH, fresh)
  const theirs = await allActivity(prs.filter(pr => !read.has(pr)), ACTIVITY_GH, fresh)
  const withPending = ([pr, items]: [number, Activity[]]): [number, Activity[]] => [pr, addPending(items, pending.get(pr) ?? [])]
  return new Map([...theirs, ...[...read].filter(([pr]) => !needsPending || pending.has(pr))].map(entry => withPending(entry)))
}

const activityReads = changeTracker()

/**
 * What a look needs to find new comments and reviews on each PR (#404): in full only for a PR the
 * change gate calls due, and asked for fresh then (an answer shared from before the change would pass
 * it by). The owner's pending review moves nothing in the gate, so for the others it alone is read,
 * on every look; a refused check holds nothing back, as the pending review just comes a look later
 * (#403). A due PR not read is missing and stays due.
 */
export const changedActivities = async (prs: readonly number[]): Promise<Map<number, Activity[]>> => {
  const { due, settle } = await activityReads.look(prs)
  const rest = prs.filter(pr => !due.includes(pr))
  const [full, pending] = await Promise.all([
    // Fresh, but a refused pending check holds nothing back: it is asked again next look.
    activitiesOf(due, true, false),
    perPr(rest, { cli: ACTIVITY_GH, fields: PENDING_FIELDS, parse: parseActivity, size: 50 }),
  ])
  settle(full.keys())
  return new Map([...rest.map((pr): [number, Activity[]] => [pr, pending.get(pr) ?? []]), ...full])
}

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
  const fresh = newActivity(await seenActivity(pr, items), items).filter(item => !isUnwritten(`pr-${pr}-seen`, item.id))
  if (fresh.length > 0) {
    queue([`PR #${pr}: ACTIVITY:`, ...fresh.flatMap(item => item.lines)], { key: `activity:${pr}:${fresh.map(item => item.id).join(',')}`, pr })
    await markSeen(`pr-${pr}-seen`, fresh.map(item => item.id))
  }
  return true
})

/** The comments on every PR followed, on their own: the owner's answers mustn't wait for CI and deploys (#240). */
export const checkTrackedActivity = async (): Promise<void> => {
  const prs = (await readLines('tracked')).map(Number)
  const activities = await changedActivities(prs)
  await allSettled(prs.map(async pr => checkActivity(pr, activities.get(pr))))
}

const MERGED_HOURS = Number(process.env.MERGED_HOURS ?? 3)

/** Whether `hours` can be taken off a time: Temporal throws on anything but a whole number in its range. */
const canGoBack = (hours: number): boolean => {
  try {
    Temporal.Now.instant().subtract({ hours })
    return hours >= 0
  } catch {
    return false
  }
}

// Temporal throwing in a look would skip every round in silence (#460).
// A blank value would read as 0, leaving out every merged PR.
if (process.env.MERGED_HOURS?.trim() === '' || !canGoBack(MERGED_HOURS)) {
  process.stderr.write('MERGED_HOURS must be a whole number from 0\n')
  process.exit(64)
}

const byNumber = (first: number, second: number) => first - second

/** Whether a closing reference's PR merged within MERGED_HOURS and after `since`. */
const mergedLately = (pr: Json, since: number): boolean => pr.state === 'MERGED' && hasText(textOf(pr.mergedAt))
  && Temporal.Instant.from(textOf(pr.mergedAt)).epochMilliseconds >= Math.max(since, Temporal.Now.instant().subtract({ hours: MERGED_HOURS }).epochMilliseconds)

/**
 * The PRs whose closing references name one of `issues` (#357), without listing every open PR: the
 * open ones, and the ones merged within MERGED_HOURS since this watcher first started, so one opened
 * and merged between two looks is still reported. An older merge closed the issue before it was
 * reopened, or came before the watcher (#477): not this subscription's news. The first hundred, one page: more PRs closing one issue are beyond an issue an agent works on.
 */
const closingPrs = async (issues: readonly number[]): Promise<{ merged: number[], open: number[] }> => {
  const since = await subscribedSince()
  const nodes = [...(await perIssue(issues, 'closedByPullRequestsReferences(first:100){nodes{number state mergedAt}}')).values()]
    .flatMap(issue => records(at(issue, 'closedByPullRequestsReferences', 'nodes')))
  return { merged: nodes.filter(pr => mergedLately(pr, since)).map(pr => count(pr.number)), open: nodes.filter(pr => pr.state === 'OPEN').map(pr => count(pr.number)) }
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
  const [{ merged, open }, followed] = lists
  // A closed linked PR is looked at again only once it is reopened.
  return [...new Set([...subscriptions.prs, ...open, ...merged, ...followed])].filter(pr => !subscriptions.isClosedPr(pr) || open.includes(pr)).toSorted(byNumber)
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
    reportedLines(),
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
