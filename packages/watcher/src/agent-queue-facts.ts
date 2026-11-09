/**
 * What `agent-queue` (#354) reads of a pull request: GitHub's GraphQL answer turned into `PrFacts`,
 * pure so it is tested. Which facts block queueing is agent-queue.ts.
 */
import { type Json, actor, at, record, records } from './watch-text'
import { hasText, isRecord, textOf } from './read'
import { bare } from './watch-review-events'

/** One check on the PR's head: its name, its result (a conclusion, or PENDING while it runs), and whether a workflow ran it. */
export interface Check {
  name: string
  result: string
  workflow: boolean
}

/** One review, oldest first. */
export interface ReviewStance {
  /** When it was submitted (ISO 8601, UTC), as GitHub gives it. */
  at: string
  login: string
  state: string
}

/** A `@<bot> review` comment: the bot it asks and when it was posted (ISO 8601, UTC). */
export interface Ask {
  at: string
  bot: string
}

/** What decides whether a PR may be queued. */
export interface PrFacts {
  /** The bots someone asked with a `@<bot> review` comment (#324, #325), in `bare` form, each with its latest ask's time, from all the PR's comments. */
  asked: readonly Ask[]
  autoMerge: boolean
  checks: readonly Check[]
  draft: boolean
  /** The PR's node id, for the mutation that queues it. */
  id: string
  /** The head commit's id: the merge is pinned to it, so what was checked is what gets queued. */
  head: string
  /** The `LabeledEvent`s and `UnlabeledEvent`s, oldest first, as `clearedAt` (watch-cleared-events.ts) reads them. */
  labelEvents: readonly Json[]
  labels: readonly string[]
  /**
   * When the head was last pushed to this PR's branch, as near as GitHub tells (ISO 8601, UTC): the
   * latest of the head commit's date, a force push, and the latest workflow check suite on the head
   * that ran for this branch (a push to it starts one; one from another branch or run proves nothing).
   * '' when no such suite is there: then it can't be told, and a label doesn't clear the PR.
   */
  lastPush: string
  /** GitHub's merge state (`CLEAN`, `BLOCKED`, `BEHIND`…); '' when it didn't say. */
  mergeState: string
  /** Whether the base branch merges through a merge queue (it takes its own merge method). */
  mergeQueue: boolean
  openThreads: number
  queued: boolean
  reviews: readonly ReviewStance[]
  /** The login asking (the bot, under `agent-gh`), from GraphQL's `viewer`: a label it put on counts. */
  self: string
  /**
   * When the last thing GitHub would act on happened, as near as it tells (ISO 8601, UTC): the latest
   * of the auto-merge request, a review or its dismissal, a label, the last push and a check finishing. '' when none is known (#544).
   */
  settledAt: string
  state: string
  truncated: boolean
}

/** A check run's or commit status's part of the rollup, as a `Check`. */
const checkFrom = (node: Json): Check => {
  if (hasText(textOf(node.context))) {
    return { name: textOf(node.context), result: textOf(node.state, 'PENDING'), workflow: false }
  }
  const result = node.status === 'COMPLETED' ? textOf(node.conclusion, 'PENDING') : 'PENDING'
  return { name: textOf(node.name), result, workflow: isRecord(at(node, 'checkSuite', 'workflowRun')) }
}

/** The bots a `@<bot> review` or `@<bot> full review` comment asked (CodeRabbit's documented triggers; the watcher posts the first), each with its latest ask; comments oldest first. */
const asksIn = (comments: readonly Json[]): Ask[] => {
  const latest = new Map<string, string>()
  for (const comment of comments) {
    const bot = /^@(?<bot>[\w-]+(?:\[bot\])?) (?:full )?review$/iu.exec(textOf(comment.body).trim())?.groups?.bot
    if (hasText(bot)) {
      latest.set(bare(bot), textOf(comment.createdAt))
    }
  }
  return [...latest].map(([bot, when]) => ({ at: when, bot }))
}

/** Whether one of the lists GitHub answered with has more than it sent: then a check, review or thread may be missing. */
const truncatedIn = (pr: unknown, contexts: unknown): boolean => [
  at(contexts, 'pageInfo', 'hasNextPage'),
  at(pr, 'labels', 'pageInfo', 'hasNextPage'),
  at(pr, 'reviewThreads', 'pageInfo', 'hasNextPage'),
  at(pr, 'reviews', 'pageInfo', 'hasPreviousPage'),
  at(pr, 'timelineItems', 'pageInfo', 'hasPreviousPage'),
].some(more => more === true)

const LABEL_EVENTS = new Set(['LabeledEvent', 'UnlabeledEvent'])

/** The latest of the times given; '' when none is. ISO 8601 times in UTC compare as text. */
const latest = (times: readonly string[]): string => times.filter(time => time !== '').toSorted().at(-1) ?? ''

const PUSH_EVENTS = new Set(['pull_request', 'push'])

/** When the head was last pushed, as `PrFacts.lastPush` says. */
const lastPushOf = ({ branch, contexts, events, head }: { branch: string, contexts: unknown, events: readonly Json[], head: unknown }): string => {
  const pushed = latest(records(at(contexts, 'nodes'))
    .filter(node => textOf(at(node, 'checkSuite', 'branch', 'name')) === branch && PUSH_EVENTS.has(textOf(at(node, 'checkSuite', 'workflowRun', 'event'))))
    .map(node => textOf(at(node, 'checkSuite', 'createdAt'))))
  if (pushed === '' || branch === '') {
    return ''
  }
  const forced = events.filter(event => event.kind === 'HeadRefForcePushedEvent').map(event => textOf(event.createdAt))
  return latest([textOf(at(head, 'commit', 'committedDate')), ...forced, pushed])
}

/** The times in `settledAt`, but for the last push, which is passed in as it is worked out already. */
const settlingTimes = (fields: Json, contexts: unknown, events: readonly Json[]): string[] => [
  textOf(at(fields, 'autoMergeRequest', 'enabledAt')),
  ...records(at(fields, 'reviews', 'nodes')).map(review => textOf(review.submittedAt)),
  ...events.filter(event => LABEL_EVENTS.has(textOf(event.kind)) || event.kind === 'ReviewDismissedEvent').map(event => textOf(event.createdAt)),
  ...records(at(contexts, 'nodes')).map(node => textOf(node.completedAt, textOf(node.createdAt))),
]

/** The facts in GitHub's answer for one `pullRequest` (`PR_QUERY`), asked as `self`. */
export const factsFrom = (pr: unknown, self: string): PrFacts => {
  const [head] = records(at(pr, 'commits', 'nodes'))
  const contexts = at(head, 'commit', 'statusCheckRollup', 'contexts')
  const events = records(at(pr, 'timelineItems', 'nodes'))
  const fields = record(pr)
  const lastPush = lastPushOf({ branch: textOf(fields.headRefName), contexts, events, head })
  return {
    asked: asksIn(records(at(pr, 'comments', 'nodes'))),
    autoMerge: isRecord(fields.autoMergeRequest),
    checks: records(at(contexts, 'nodes')).map(node => checkFrom(node)),
    draft: fields.isDraft === true,
    head: textOf(fields.headRefOid),
    id: textOf(fields.id),
    labelEvents: events.filter(event => LABEL_EVENTS.has(textOf(event.kind))),
    labels: records(at(pr, 'labels', 'nodes')).map(label => textOf(label.name)),
    lastPush,
    mergeQueue: fields.isMergeQueueEnabled === true,
    mergeState: textOf(fields.mergeStateStatus),
    openThreads: records(at(pr, 'reviewThreads', 'nodes')).filter(thread => thread.isResolved !== true).length,
    queued: fields.isInMergeQueue === true,
    reviews: records(at(pr, 'reviews', 'nodes')).map(review => ({ at: textOf(review.submittedAt), login: actor(review.author), state: textOf(review.state) })),
    self,
    settledAt: latest([...settlingTimes(fields, contexts, events), lastPush]),
    state: textOf(fields.state),
    truncated: truncatedIn(pr, contexts),
  }
}
