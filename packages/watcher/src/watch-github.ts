/** The project watcher's questions to GitHub, through the `gh` CLI, answered as plain data. */
import { type MainRun, type OpenPr, type Run, approvedBy, decisionFrom } from './watch-events'
import type { QueueEntry } from './watch-queue-events'
import { REVIEW_BOTS, type ReviewThread, botReviewed, threadsToResolve } from './watch-review-events'
import { allIssueNumbers, goneIssueLine, isGone, isMoved, issueEventLine, issuePage } from './watch-issue-events'
import { GH, failedStatus, ghText } from './watch-gh'
import { ownerOfRepo } from './watch-owner'
import { ownerApprovalCommit } from './watch-ready-events'
import { hasText, isRecord, textOf } from './read'
import { type Json, actor, at, count, oneLine, record, records } from './watch-text'

// Settings, all from the environment (#200), so the watcher works in any repository; GH,
// GH_TIMEOUT_SECONDS and GH_PARALLEL are in watch-gh.ts.
// REPO: `owner/name`; by default the repository `gh` finds in the current folder.
const currentRepo = async (): Promise<string> => {
  const repo = await ghText(['repo', 'view', '--json', 'nameWithOwner', '-q', '.nameWithOwner'], GH, true).then(text => text.trim(), (error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : ''}\n`)
    return ''
  })
  if (!hasText(repo)) {
    process.stderr.write(`Which repository? Run this inside a GitHub repository's folder with ${GH} logged in, or set REPO=owner/name.\n`)
    process.exit(2)
  }
  return repo
}
export const REPO = hasText(process.env.REPO) ? process.env.REPO : await currentRepo()
/**
 * Whether the default branch merges through a merge queue (#228). The queue then sets the merge
 * strategy, and `gh pr merge --squash` says so on every call; without one, `gh` needs a strategy.
 * Unknown (the question failed) counts as no queue, as before.
 */
const mergeQueued = async (): Promise<boolean> => {
  const [owner = '', name = ''] = REPO.split('/')
  const query = `query={repository(owner:"${owner}",name:"${name}"){mergeQueue{id}}}`
  return ghText(['api', 'graphql', '-f', query, '-q', '.data.repository.mergeQueue.id']).then(text => hasText(text.trim()), () => false)
}
export const MERGE_QUEUE = await mergeQueued()

/** The command that enables auto-merge for a PR, as the events suggest it. */
export const mergeCommand = (pr: number): string => `${GH} pr merge ${pr} --auto${MERGE_QUEUE ? '' : ' --squash'}`
/** The command that marks a draft PR ready for review (#298). */
export const readyCommand = (pr: number): string => `${GH} pr ready ${pr}`
// WORKFLOW: the CI workflow file whose runs are followed (a PR's checks, main's deploy).
const WORKFLOW = process.env.WORKFLOW ?? 'ci.yml'
// ACTIVITY_GH: comments are read with the owner's login: a pending (unsubmitted) review is only
// visible to its author, and the owner leaves those.
export const ACTIVITY_GH = process.env.ACTIVITY_GH ?? 'gh'
// OWNER: whose issue comments are news, and whose approval counts as one (#277); by default the
// repository's owner, or for an organisation's repository its one human admin (#295).
export const OWNER = process.env.OWNER ?? await ownerOfRepo(REPO)
// SELF: the agent's own login. Its comments and replies in review threads are not news to it; its
// reviews (a reviewer agent posting as the same login) still are. None by default.
export const SELF = process.env.SELF ?? ''
// Nx Cloud's status comment on every push needs no answer.
export const IGNORED = new Set([SELF, 'nx-cloud[bot]'])

export const gh = async (args: string[], cli = GH, fresh = false): Promise<unknown> => JSON.parse(await ghText(args, cli, fresh))

const runFrom = (value: Json): Run => ({
  ageSeconds: Math.floor(Temporal.Instant.from(textOf(value.startedAt)).until(Temporal.Now.instant()).total('seconds')),
  attempt: count(value.attempt),
  conclusion: textOf(value.conclusion),
  id: count(value.databaseId),
  status: textOf(value.status),
})

const RUN_FIELDS = 'databaseId,attempt,startedAt,status,conclusion'

/** The CI run of a commit; null when there is none yet. */
export const runOf = async (sha: string): Promise<Run | null> => {
  const [run] = records(await gh(['run', 'list', '--repo', REPO, '--workflow', WORKFLOW, '--commit', sha, '--json', RUN_FIELDS]))
  return run ? runFrom(run) : null
}

/**
 * The newest CI runs on main, newest first, with their commits. A hundred, one page of GitHub's list
 * (#270): enough newer runs for a cancelled deploy that some of them passed or contain its commit.
 */
export const mainRuns = async (limit = 100): Promise<MainRun[]> =>
  records(await gh(['run', 'list', '--repo', REPO, '--workflow', WORKFLOW, '--branch', 'main', '--event', 'push', '--limit', String(limit), '--json', `${RUN_FIELDS},headSha`]))
    .map(run => ({ run: runFrom(run), sha: textOf(run.headSha) }))

/** Whether commit `newer` contains commit `older`: it is the same commit, or `older` is one of its ancestors. */
export const containsCommit = async (newer: string, older: string): Promise<boolean> => {
  const status = textOf(record(await gh(['api', `repos/${REPO}/compare/${older}...${newer}?per_page=1`])).status)
  return status === 'ahead' || status === 'identical'
}

/** The newest CI run on main, and its commit. */
export const newestMainRun = async (): Promise<MainRun | null> => (await mainRuns(1))[0] ?? null

export const jobLines = async (run: number): Promise<string[]> =>
  records(record(await gh(['run', 'view', String(run), '--repo', REPO, '--json', 'jobs'])).jobs)
    .map(job => `  ${textOf(job.name)}: ${textOf(job.status)} ${textOf(job.conclusion)}`)

/** Asks for `fields` of the repository through GraphQL, with `cli` (the `GH` token by default). */
export const graphql = async (fields: string, fresh = false, cli = GH): Promise<Json> => {
  const [owner = '', name = ''] = REPO.split('/')
  return record(record(record(await gh(['api', 'graphql', '-f', `query={repository(owner:"${owner}",name:"${name}"){${fields}}}`], cli, fresh)).data).repository)
}

/**
 * What `parse` makes of each PR asked about, its `fields` read in one GraphQL query per `size` PRs
 * (#235, #306): one REST call per PR and question cost seconds each on a slow `gh`, and agents sharing
 * one app installation had REST calls refused with 403 rate-limit errors in bursts, while GraphQL went
 * through. A PR that couldn't be read is missing from the answer; its caller tries again next look. If
 * a batch fails (one PR GitHub won't answer for fails it all), each of its PRs is asked alone.
 */
export const perPr = async <Value>(prs: readonly number[],
  { cli = GH, fields, fresh = false, parse, size }: { cli?: string, fields: string, fresh?: boolean, parse: (value: Json) => Value, size: number }): Promise<Map<number, Value>> => {
  const ask = async (batch: readonly number[]): Promise<[number, Value][]> => {
    const repository = await graphql(batch.map(pr => `pr${pr}: pullRequest(number: ${pr}) { ${fields} }`).join(' '), fresh, cli)
    return batch.flatMap((pr): [number, Value][] => {
      const value = repository[`pr${pr}`]
      return isRecord(value) ? [[pr, parse(value)]] : []
    })
  }
  const oneByOne = async (batch: readonly number[]): Promise<[number, Value][]> =>
    (await Promise.all(batch.map(async pr => ask([pr]).catch((): [number, Value][] => [])))).flat()
  const chunks = Array.from({ length: Math.ceil(prs.length / size) }, (_chunk, index) => prs.slice(index * size, (index + 1) * size))
  return new Map((await Promise.all(chunks.map(async chunk => ask(chunk).catch(async () => oneByOne(chunk))))).flat())
}

/** Every PR in the merge queue, by number (#251); none where the default branch has no queue. */
export const queueEntries = async (): Promise<Map<number, QueueEntry>> => {
  if (!MERGE_QUEUE) {
    return new Map()
  }
  const entries = records(at(await graphql('mergeQueue{entries(first:100){nodes{position enqueuedAt pullRequest{number}}}}'), 'mergeQueue', 'entries', 'nodes'))
  // GitHub may leave an entry without its PR: such an entry isn't one of ours to report.
  return new Map(entries.filter(entry => isRecord(entry.pullRequest))
    .map(entry => [count(record(entry.pullRequest).number), { enqueuedAt: textOf(entry.enqueuedAt), position: count(entry.position) }]))
}

/** Why a PR last left the merge queue, as GitHub puts it; '' when it doesn't say. */
export const dequeueReason = async (pr: number): Promise<string> => {
  const query = `pullRequest(number:${pr}){timelineItems(last:1,itemTypes:[REMOVED_FROM_MERGE_QUEUE_EVENT]){nodes{...on RemovedFromMergeQueueEvent{reason}}}}`
  const removal = records(at(await graphql(query), 'pullRequest', 'timelineItems', 'nodes'))
  return oneLine(removal.at(-1)?.reason, 200)
}

export interface PrState {
  state: string
  mergeable: string
  /** GitHub's `mergeStateStatus`: `BLOCKED` while a rule (a review, an open thread) holds it back. */
  mergeState: string
  head: string
  mergeSha: string
  decision: string
  ownerApproved: boolean
  /** The commit the owner's latest review approves, '' when it isn't an approval (#301, #317). */
  ownerApprovalCommit: string
  autoMerge: boolean
  draft: boolean
  botReviewed: boolean
  parked: boolean
  queued: boolean
  title: string
  toResolve: ReviewThread[]
}

/** A PR's review threads, each with its last comment: the first hundred, more is beyond a PR the agent babysits. */
const THREAD_FIELDS = 'reviewThreads(first:100){nodes{id isResolved comments(last:1){nodes{body url author{login kind:__typename}}}}}'
export const threadsFrom = (value: unknown): ReviewThread[] => records(at(value, 'reviewThreads', 'nodes')).map(thread => {
  const last = records(at(thread, 'comments', 'nodes')).at(-1) ?? {}
  const review = count(at(records(at(thread, 'first', 'nodes'))[0], 'pullRequestReview', 'databaseId'))
  return { id: textOf(thread.id), lastAuthor: actor(last.author), lastBody: textOf(last.body), resolved: thread.isResolved === true, review, url: textOf(last.url) }
})
const PR_FIELDS = 'isDraft isInMergeQueue state mergeable mergeStateStatus headRefOid mergeCommit { oid } reviewDecision autoMergeRequest { enabledAt } title'
  + ` labels(first: 100) { nodes { name } } author { login kind: __typename } reviews(last: 100) { nodes { state commit { oid } author { login kind: __typename } } } ${THREAD_FIELDS}`

const stateOf = (value: Json): PrState => {
  const author = actor(value.author)
  const reviews = records(record(value.reviews).nodes)
    .map(review => ({ commit: textOf(record(review.commit).oid), login: actor(review.author), state: textOf(review.state) }))
    .filter(review => review.login !== author && review.login !== SELF)
  return {
    autoMerge: isRecord(value.autoMergeRequest),
    botReviewed: botReviewed(REVIEW_BOTS, records(record(value.reviews).nodes), textOf(value.headRefOid)),
    // GitHub leaves `reviewDecision` empty under a ruleset (#197), and counts anyone's approval: the
    // reviews decide, an approval counting only from the owner (#277).
    decision: decisionFrom(textOf(value.reviewDecision), reviews, OWNER),
    draft: value.isDraft === true,
    head: textOf(value.headRefOid),
    mergeSha: textOf(record(value.mergeCommit).oid),
    mergeState: textOf(value.mergeStateStatus),
    mergeable: textOf(value.mergeable),
    ownerApproved: approvedBy(reviews, OWNER),
    // The commit the owner's latest review approves, on any commit: it marks a draft ready where
    // READY_APPROVED_DRAFTS is on (#301, #317).
    ownerApprovalCommit: ownerApprovalCommit(reviews, OWNER),
    parked: records(record(value.labels).nodes).some(label => label.name === 'parked'),
    queued: value.isInMergeQueue === true,
    state: textOf(value.state),
    title: `${textOf(value.title)} (by ${author})`,
    toResolve: threadsToResolve(threadsFrom(value)),
  }
}

/**
 * The state of every PR asked about, fifty to a query (see `perPr`); one whose state couldn't be read
 * is missing. `fresh` asks GitHub even when another watcher just did (#264).
 */
export const prStates = async (prs: readonly number[], fresh = false): Promise<Map<number, PrState>> =>
  perPr(prs, { fields: PR_FIELDS, fresh, parse: stateOf, size: 50 })

export const openPrs = async (): Promise<OpenPr[]> => {
  const [listed, queue] = await Promise.all([
    gh(['pr', 'list', '--repo', REPO, '--state', 'open', '--limit', '100', '--json', 'number,title,isDraft,headRefOid,reviews,autoMergeRequest,labels,statusCheckRollup,mergeStateStatus']),
    // An unreadable queue lists the PRs as not queued (#251), rather than leaving out the list and its reminders.
    queueEntries().catch((): Map<number, QueueEntry> => new Map()),
  ])
  // The review decision as `prStates` reads it, through GraphQL (#306). Unknown (empty) for a PR
  // whose state couldn't be read: it is then simply not approved yet this round, rather than the
  // whole listing failing.
  const states = await prStates(records(listed).map(pr => count(pr.number)))
  return records(listed)
    .map(pr => ({
      autoMerge: Boolean(pr.autoMergeRequest),
      botReviewed: botReviewed(REVIEW_BOTS, records(pr.reviews), textOf(pr.headRefOid)),
      checks: records(pr.statusCheckRollup).map(check => textOf(check.conclusion) || textOf(check.state) || 'pending'),
      draft: pr.isDraft === true,
      mergeState: textOf(pr.mergeStateStatus),
      number: count(pr.number),
      parked: records(pr.labels).some(label => label.name === 'parked'),
      queued: queue.has(count(pr.number)),
      reviewDecision: states.get(count(pr.number))?.decision ?? '',
      title: textOf(pr.title),
    }))
}

/** Resolves a review thread with the `GH` token, on a `Resolved:` reply (#279); never a shared answer. */
export const resolveThread = async (id: string): Promise<boolean> => {
  const answer = await gh(['api', 'graphql', '-f', `query=mutation{resolveReviewThread(input:{threadId:${JSON.stringify(id)}}){thread{isResolved}}}`], GH, true)
  return at(answer, 'data', 'resolveReviewThread', 'thread', 'isResolved') === true
}

/** Pull requests merged in the last `hours`. */
export const recentlyMerged = async (hours: number): Promise<number[]> => {
  const since = Temporal.Now.instant().subtract({ hours })
  return records(await gh(['pr', 'list', '--repo', REPO, '--state', 'merged', '--limit', '20', '--json', 'number,mergedAt']))
    .filter(pr => Temporal.Instant.compare(Temporal.Instant.from(textOf(pr.mergedAt)), since) > 0)
    .map(pr => count(pr.number))
}

/** Commits main has that `head` doesn't, and the newest of them. */
export const mainAhead = async (head: string): Promise<{ ahead: number, newest: string }> => {
  const value = record(await gh(['api', `repos/${REPO}/compare/${head}...main`]))
  return { ahead: count(value.ahead_by), newest: textOf(records(value.commits).at(-1)?.sha) || '-' }
}

export const mainHead = async (): Promise<{ sha: string, subject: string }> => {
  const value = record(await gh(['api', `repos/${REPO}/commits/main`]))
  return { sha: textOf(value.sha), subject: textOf(record(value.commit).message).split('\n')[0] ?? '' }
}

/** Every open issue's number (#261), through GraphQL: the REST list stops after its first hundred. */
export const openIssueNumbers = async (): Promise<number[]> => allIssueNumbers(async cursor =>
  issuePage(at(await graphql(`issues(states:OPEN,first:100,after:${JSON.stringify(cursor)}){nodes{number} pageInfo{hasNextPage endCursor}}`), 'issues')))

/**
 * The line for an issue that left or joined the open list. An issue that is gone (deleted or
 * transferred) is an answer too (#263): failing on it would hold back every later round's changes.
 * Any other failure fails, and the round is tried again.
 */
export const issueLine = async (issue: number, change: 'closed' | 'reopened'): Promise<string | null> => {
  const value = await gh(['api', `repos/${REPO}/issues/${issue}`]).then(record, (error: unknown) => {
    if (isGone(failedStatus(error))) {
      return null
    }
    throw error
  })
  return value === null || isMoved(value, REPO) ? goneIssueLine(issue, change) : issueEventLine(issue, value, change)
}
