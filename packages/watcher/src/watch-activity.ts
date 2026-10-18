/** The project watcher's look at a pull request's comments and reviews (watch-project.ts). */
import { type Activity, newActivity } from './watch-events'
import { activityOf, reviewCommentLines } from './watch-comments'
import { appendLines, exists, oneAtATime, readLines, writeLines } from './watch-state'
import { allSettled } from './read'
import { queue } from './watch-output'

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

/** Records the new comments and reviews as seen and prints them (or keeps them for this round's events). */
const queueActivity = async (pr: number, fresh: Activity[]): Promise<void> => {
  // A review whose line comments couldn't be read stays unseen: the next look reports it with them.
  const read = await Promise.all(fresh.map(async item => {
    const comments = item.id.startsWith('review ') ? await reviewCommentLines(pr, item.id.split(' ')[1] ?? '').catch(() => null) : []
    return { comments, item }
  }))
  await appendLines(`pr-${pr}-seen`, read.filter(entry => entry.comments !== null).map(entry => entry.item.id))
  queue([`PR #${pr}: ACTIVITY:`, ...read.flatMap(({ comments, item }) => item.lines.concat(comments ?? ['  (its line comments couldn\'t be read yet: they come next look)']))])
}

/**
 * New comments and reviews on a PR; false when GitHub couldn't be asked (tried again next round). One
 * look per PR at a time: both pollers ask (#240), and two at once would report the same comment twice.
 */
export const checkActivity = async (pr: number): Promise<boolean> => oneAtATime(`activity ${pr}`, async () => {
  const items = await activityOf(pr).catch(() => null)
  if (!items) {
    return false
  }
  const fresh = newActivity(await seenActivity(pr, items), items)
  if (fresh.length > 0) {
    await queueActivity(pr, fresh)
  }
  return true
})

/** The comments on every PR followed, on their own: the owner's answers mustn't wait for CI and deploys (#240). */
export const checkTrackedActivity = async (): Promise<void> => {
  const prs = (await readLines('tracked')).map(Number)
  await allSettled(prs.map(async pr => checkActivity(pr)))
}
