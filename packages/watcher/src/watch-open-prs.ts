/** The list of open PRs that CI results and reminders end with, asked for once per look (#404). */
import type { OpenPr, Run } from './watch-events'
import { NO_BOT_REVIEW } from './watch-bot-review-events'
import type { QueueEntry } from './watch-queue-events'
import { REPO, gh, queueEntries, runOf } from './watch-github'
import { changedStates } from './watch-change-gate'
import { hasText, textOf } from './read'
import { count, records } from './watch-text'

export { REPO } from './watch-github'

/**
 * WORKFLOW's run on `head` (#342); null when unreadable. The same question each look asks about an open
 * PR's head, so the shared answer costs no call of its own.
 */
const headRunOf = async (head: string): Promise<Run | null> => hasText(head) ? runOf(head).catch(() => null) : null

const openPrs = async (): Promise<OpenPr[]> => {
  const [listed, queue] = await Promise.all([
    gh(['pr', 'list', '--repo', REPO, '--state', 'open', '--limit', '100', '--json', 'number,title,isDraft,autoMergeRequest,labels,statusCheckRollup,mergeStateStatus,headRefOid']),
    // An unreadable queue lists the PRs as not queued (#251), rather than leaving out the list and its reminders.
    queueEntries().catch((): Map<number, QueueEntry> => new Map()),
  ])
  // The review decision as `prStates` reads it, through GraphQL (#306). Unknown (empty) for a PR
  // whose state couldn't be read: it is then simply not approved yet this round, rather than the
  // whole listing failing.
  const states = await changedStates(records(listed).map(pr => count(pr.number)))
  const headRuns = await Promise.all(records(listed).map(async pr => headRunOf(textOf(pr.headRefOid))))
  return records(listed)
    .map((pr, index) => ({
      autoMerge: Boolean(pr.autoMergeRequest),
      bot: states.get(count(pr.number))?.bot ?? NO_BOT_REVIEW,
      checks: records(pr.statusCheckRollup).map(check => textOf(check.conclusion) || textOf(check.state) || 'pending'),
      draft: pr.isDraft === true,
      headRun: headRuns[index] ?? null,
      mergeState: textOf(pr.mergeStateStatus),
      number: count(pr.number),
      parked: records(pr.labels).some(label => label.name === 'parked'),
      queued: queue.has(count(pr.number)),
      reviewDecision: states.get(count(pr.number))?.decision ?? '',
      title: textOf(pr.title),
    }))
}

const look: { prs: Promise<OpenPr[]> | null } = { prs: null }

/** The open PRs, asked for once until `endOpenPrsLook`; a failed listing is asked for again. */
export const openPrsThisLook = async (): Promise<OpenPr[]> => {
  look.prs ??= openPrs().catch((error: unknown) => {
    look.prs = null
    throw error
  })
  return look.prs
}

export const endOpenPrsLook = (): void => { look.prs = null }
