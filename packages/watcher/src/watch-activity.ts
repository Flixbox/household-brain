/** The project watcher's look at a pull request's comments and reviews (watch-project.ts). */
import { type Activity, newActivity } from './watch-events'
import { ACTIVITY_FIELDS, activityFrom } from './watch-comment-lines'
import { ACTIVITY_GH, IGNORED, OWNER, SELF, perPr } from './watch-github'
import { appendLines, exists, oneAtATime, readLines, writeLines } from './watch-state'
import { allSettled } from './read'
import { queue } from './watch-output'

/**
 * Comments, reviews (not plain approvals, each with its line comments) and review comments on each PR
 * asked about, the agent's own left out (see `activityFrom`). Read through GraphQL (#306), twenty PRs to
 * a query, so a reviewed PR's hundred reviews of a hundred line comments each stay within GitHub's
 * limits; a PR that couldn't be read is missing.
 */
export const activitiesOf = async (prs: readonly number[]): Promise<Map<number, Activity[]>> =>
  perPr(prs, { cli: ACTIVITY_GH, fields: ACTIVITY_FIELDS, parse: value => activityFrom(value, { ignored: IGNORED, owner: OWNER, self: SELF }), size: 20 })

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
    queue([`PR #${pr}: ACTIVITY:`, ...fresh.flatMap(item => item.lines)])
  }
  return true
})

/** The comments on every PR followed, on their own: the owner's answers mustn't wait for CI and deploys (#240). */
export const checkTrackedActivity = async (): Promise<void> => {
  const prs = (await readLines('tracked')).map(Number)
  const activities = await activitiesOf(prs)
  await allSettled(prs.map(async pr => checkActivity(pr, activities.get(pr))))
}
