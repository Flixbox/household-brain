/** The project watcher's questions to GitHub, through the `gh` CLI, answered as plain data. */
import { type Activity, type OpenPr, type QueueEntry, type Run, clockTime, decisionFrom } from './watch-events'
import { GH, ghText } from './watch-gh'
import { hasText, isRecord, textOf } from './read'

// Settings, all from the environment (#200), so the watcher works in any repository; GH,
// GH_TIMEOUT_SECONDS and GH_PARALLEL are in watch-gh.ts.
// REPO: `owner/name`; by default the repository `gh` finds in the current folder.
const currentRepo = async (): Promise<string> => {
  const repo = await ghText(['repo', 'view', '--json', 'nameWithOwner', '-q', '.nameWithOwner']).then(text => text.trim(), (error: unknown) => {
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
const MERGE_QUEUE = await mergeQueued()

/** The command that enables auto-merge for a PR, as the events suggest it. */
export const mergeCommand = (pr: number): string => `${GH} pr merge ${pr} --auto${MERGE_QUEUE ? '' : ' --squash'}`
// WORKFLOW: the CI workflow file whose runs are followed (a PR's checks, main's deploy).
const WORKFLOW = process.env.WORKFLOW ?? 'ci.yml'
// ACTIVITY_GH: comments are read with the owner's login: a pending (unsubmitted) review is only
// visible to its author, and the owner leaves those.
const ACTIVITY_GH = process.env.ACTIVITY_GH ?? 'gh'
// OWNER: whose issue comments are news; by default the repository's owner.
const OWNER = process.env.OWNER ?? REPO.split('/')[0] ?? ''
// SELF: the agent's own login. Its comments and replies in review threads are not news to it; its
// reviews (a reviewer agent posting as the same login) still are. None by default.
const SELF = process.env.SELF ?? ''
// Nx Cloud's status comment on every push needs no answer.
const IGNORED = new Set([SELF, 'nx-cloud[bot]'])

type Json = Record<string, unknown>

const records = (value: unknown): Json[] => (Array.isArray(value) ? value.filter(item => isRecord(item)) : [])

/** The line a review comment is on; one on an outdated diff only has its original line. */
const lineOf = (item: Record<string, unknown>) => [item.line, item.original_line].find((value): value is number => typeof value === 'number')
const count = (value: unknown) => (typeof value === 'number' ? value : 0)
const record = (value: unknown): Json => (isRecord(value) ? value : {})
const oneLine = (value: unknown, length: number) => textOf(value).replaceAll(/\s+/gu, ' ').slice(0, length)

const gh = async (args: string[], cli = GH): Promise<unknown> => JSON.parse(await ghText(args, cli))

/** Every item of a paged list, all pages in one array (`--slurp` wraps each page). */
const allPages = async (path: string, cli = GH): Promise<Json[]> => {
  const pages = await gh(['api', '--paginate', '--slurp', path], cli)
  return Array.isArray(pages) ? pages.flatMap(item => records(item)) : []
}

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

/** The newest CI run on main, and its commit. */
export const newestMainRun = async (): Promise<{ run: Run, sha: string } | null> => {
  const [run] = records(await gh(['run', 'list', '--repo', REPO, '--workflow', WORKFLOW, '--branch', 'main', '--event', 'push', '--limit', '1', '--json', `${RUN_FIELDS},headSha`]))
  return run ? { run: runFrom(run), sha: textOf(run.headSha) } : null
}

export const jobLines = async (run: number): Promise<string[]> =>
  records(record(await gh(['run', 'view', String(run), '--repo', REPO, '--json', 'jobs'])).jobs)
    .map(job => `  ${textOf(job.name)}: ${textOf(job.status)} ${textOf(job.conclusion)}`)

/**
 * GitHub's review decision, or, where it leaves that empty (a ruleset instead of branch protection),
 * the one the reviews add up to. The PR's author and the agent itself don't count (the reviewer agent
 * posts as the same bot that opens the PRs), and one approval counts as approved: GitHub's own merge
 * still enforces how many a ruleset requires. Unknown (empty) when the reviews can't be read: the PR
 * is then simply not approved yet this round, rather than the whole listing failing.
 */
const decisionOf = async (pr: number, reviewDecision: unknown, author: string): Promise<string> => {
  const given = textOf(reviewDecision)
  if (given !== '') {
    return given
  }
  const reviews = await allPages(`repos/${REPO}/pulls/${pr}/reviews`).catch(() => [])
  return decisionFrom(reviews
    .map(item => ({ login: login(item), state: textOf(item.state) }))
    .filter(review => review.login !== author && review.login !== SELF))
}

const graphql = async (fields: string): Promise<Json> => {
  const [owner = '', name = ''] = REPO.split('/')
  return record(record(record(await gh(['api', 'graphql', '-f', `query={repository(owner:"${owner}",name:"${name}"){${fields}}}`])).data).repository)
}

/** What is at `keys` inside a GraphQL answer; an empty object where something on the way is missing. */
const at = (value: unknown, ...keys: string[]): unknown => keys.reduce((inside: unknown, key) => record(inside)[key], value)

/** Every PR in the merge queue, by number (#251); none where the default branch has no queue. */
export const queueEntries = async (): Promise<Map<number, QueueEntry>> => {
  if (!MERGE_QUEUE) {
    return new Map()
  }
  const entries = records(at(await graphql('mergeQueue{entries(first:100){nodes{position enqueuedAt pullRequest{number}}}}'), 'mergeQueue', 'entries', 'nodes'))
  return new Map(entries.map(entry => [count(record(entry.pullRequest).number), { enqueuedAt: textOf(entry.enqueuedAt), position: count(entry.position) }]))
}

/** Why a PR last left the merge queue, as GitHub puts it; '' when it doesn't say. */
export const dequeueReason = async (pr: number): Promise<string> => {
  const query = `pullRequest(number:${pr}){timelineItems(last:1,itemTypes:[REMOVED_FROM_MERGE_QUEUE_EVENT]){nodes{...on RemovedFromMergeQueueEvent{reason}}}}`
  const removal = records(at(await graphql(query), 'pullRequest', 'timelineItems', 'nodes'))
  return oneLine(removal.at(-1)?.reason, 200)
}

export const openPrs = async (): Promise<OpenPr[]> => {
  const [listed, queue] = await Promise.all([
    gh(['pr', 'list', '--repo', REPO, '--state', 'open', '--limit', '100', '--json', 'number,title,reviewDecision,autoMergeRequest,labels,statusCheckRollup,author,mergeStateStatus']),
    queueEntries(),
  ])
  return Promise.all(records(listed)
    .map(async pr => ({
      autoMerge: Boolean(pr.autoMergeRequest),
      checks: records(pr.statusCheckRollup).map(check => textOf(check.conclusion) || textOf(check.state) || 'pending'),
      mergeState: textOf(pr.mergeStateStatus),
      number: count(pr.number),
      parked: records(pr.labels).some(label => label.name === 'parked'),
      queued: queue.has(count(pr.number)),
      reviewDecision: await decisionOf(count(pr.number), pr.reviewDecision, textOf(record(pr.author).login)),
      title: textOf(pr.title),
    })))
}

export interface PrState {
  state: string
  mergeable: string
  head: string
  mergeSha: string
  decision: string
  autoMerge: boolean
  parked: boolean
  queued: boolean
  title: string
}

const PR_FIELDS = 'isInMergeQueue state mergeable headRefOid mergeCommit { oid } reviewDecision autoMergeRequest { enabledAt } title'
  + ' labels(first: 100) { nodes { name } } author { login kind: __typename } reviews(last: 100) { nodes { state author { login kind: __typename } } }'
const PRS_PER_QUERY = 50

/** GraphQL names a bot `name`, the REST API (and `SELF`) `name[bot]`: the REST form, as everywhere else. */
const actor = (value: unknown): string => {
  const who = record(value)
  return who.kind === 'Bot' ? `${textOf(who.login)}[bot]` : textOf(who.login)
}

const stateOf = (value: Json): PrState => {
  const author = actor(value.author)
  const reviews = records(record(value.reviews).nodes)
    .map(review => ({ login: actor(review.author), state: textOf(review.state) }))
    .filter(review => review.login !== author && review.login !== SELF)
  return {
    autoMerge: isRecord(value.autoMergeRequest),
    // GitHub leaves `reviewDecision` empty under a ruleset: then the reviews decide (#197).
    decision: textOf(value.reviewDecision) || decisionFrom(reviews),
    head: textOf(value.headRefOid),
    mergeSha: textOf(record(value.mergeCommit).oid),
    mergeable: textOf(value.mergeable),
    parked: records(record(value.labels).nodes).some(label => label.name === 'parked'),
    queued: value.isInMergeQueue === true,
    state: textOf(value.state),
    title: `${textOf(value.title)} (by ${author})`,
  }
}

const statesOf = async (prs: readonly number[]): Promise<[number, PrState][]> => {
  const repository = await graphql(prs.map(pr => `pr${pr}: pullRequest(number: ${pr}) { ${PR_FIELDS} }`).join(' '))
  return prs.flatMap((pr): [number, PrState][] => {
    const value = repository[`pr${pr}`]
    return isRecord(value) ? [[pr, stateOf(value)]] : []
  })
}

/** Each PR on its own, so one GitHub won't answer for is the only one missing. */
const oneByOne = async (prs: readonly number[]): Promise<[number, PrState][]> => {
  const each = await Promise.all(prs.map(async pr => statesOf([pr]).catch((): [number, PrState][] => [])))
  return each.flat()
}

/** A batch's states; if the batch fails (one PR GitHub won't answer for fails it all), each PR alone. */
const batchStates = async (prs: readonly number[]): Promise<[number, PrState][]> =>
  statesOf(prs).catch(async () => oneByOne(prs))

/**
 * The state of every PR asked about, in one GraphQL query per fifty (#235): one `pr view` each, plus
 * their reviews, took seconds per PR on a slow `gh`, and a look waited for all of them. A PR whose
 * state couldn't be read is missing from the answer; its caller tries again next look.
 */
export const prStates = async (prs: readonly number[]): Promise<Map<number, PrState>> => {
  const chunks = Array.from({ length: Math.ceil(prs.length / PRS_PER_QUERY) }, (_chunk, index) => prs.slice(index * PRS_PER_QUERY, (index + 1) * PRS_PER_QUERY))
  return new Map((await Promise.all(chunks.map(async chunk => batchStates(chunk)))).flat())
}

/** Pull requests merged in the last `hours`. */
export const recentlyMerged = async (hours: number): Promise<number[]> => {
  const since = Temporal.Now.instant().subtract({ hours })
  return records(await gh(['pr', 'list', '--repo', REPO, '--state', 'merged', '--limit', '20', '--json', 'number,mergedAt']))
    .filter(pr => Temporal.Instant.compare(Temporal.Instant.from(textOf(pr.mergedAt)), since) > 0)
    .map(pr => count(pr.number))
}

/** Who wrote a comment or review, and when (#240): `Flixbox at 12:09:20`. */
const login = (item: Json) => textOf(record(item.user).login)
const byline = (item: Json) => `${login(item)} at ${clockTime(item.created_at ?? item.submitted_at) ?? '?'}`

/** Comments, reviews (not plain approvals) and review comments on a PR, the agent's own left out. */
export const activityOf = async (pr: number): Promise<Activity[]> => {
  const [comments, reviews, reviewComments] = await Promise.all([
    allPages(`repos/${REPO}/issues/${pr}/comments`, ACTIVITY_GH),
    allPages(`repos/${REPO}/pulls/${pr}/reviews`, ACTIVITY_GH),
    allPages(`repos/${REPO}/pulls/${pr}/comments`, ACTIVITY_GH),
  ])
  return [
    ...comments.filter(item => !IGNORED.has(login(item)))
      .map(item => ({ id: `comment ${count(item.id)}`, line: `comment ${count(item.id)} ${byline(item)}: ${oneLine(item.body, 200)}` })),
    ...reviews.filter(item => (item.state !== 'APPROVED' || textOf(item.body) !== '') && (login(item) !== SELF || textOf(item.body) !== ''))
      .map(item => ({ id: `review ${count(item.id)}`, line: `review ${count(item.id)} ${byline(item)} ${textOf(item.state)}: ${oneLine(item.body, 200)}` })),
    ...reviewComments.filter(item => login(item) !== SELF || (item.in_reply_to_id ?? null) === null)
      .map(item => ({ id: `review-comment ${count(item.id)}`, line: `review-comment ${count(item.id)} ${byline(item)} ${textOf(item.path)}: ${oneLine(item.body, 200)}` })),
  ]
}

/** A review's own comments; a pending review's are only visible to its author (the owner's login). */
export const reviewCommentLines = async (pr: number, review: string): Promise<string[]> =>
  records(await gh(['api', `repos/${REPO}/pulls/${pr}/reviews/${review}/comments`], ACTIVITY_GH))
    .map(item => `  ${textOf(item.path)}:${lineOf(item) ?? 'file'}: ${oneLine(item.body, 400)}`)

/** Commits main has that `head` doesn't, and the newest of them. */
export const mainAhead = async (head: string): Promise<{ ahead: number, newest: string }> => {
  const value = record(await gh(['api', `repos/${REPO}/compare/${head}...main`]))
  return { ahead: count(value.ahead_by), newest: textOf(records(value.commits).at(-1)?.sha) || '-' }
}

export const mainHead = async (): Promise<{ sha: string, subject: string }> => {
  const value = record(await gh(['api', `repos/${REPO}/commits/main`]))
  return { sha: textOf(value.sha), subject: textOf(record(value.commit).message).split('\n')[0] ?? '' }
}

/**
 * New issues (not the agent's own) and the owner's comments on issues, newest first, each with when
 * it was written and the key it is remembered by: its id, never its text (#247).
 */
export const issueEventLines = async (): Promise<{ at: unknown, key: string, line: string }[]> => {
  const [issues, comments] = await Promise.all([
    gh(['api', `repos/${REPO}/issues?state=all&per_page=50&sort=created&direction=desc`]),
    gh(['api', `repos/${REPO}/issues/comments?per_page=50&sort=created&direction=desc`]),
  ])
  return [
    ...records(issues).filter(issue => (issue.pull_request ?? null) === null && textOf(record(issue.user).login) !== SELF)
      .map(issue => ({ at: issue.created_at, key: `issue #${count(issue.number)}`, line: `NEW_ISSUE #${count(issue.number)} ${oneLine(issue.title, 200)}` })),
    ...records(comments).filter(comment => textOf(record(comment.user).login) === OWNER && textOf(comment.html_url).includes('/issues/'))
      .map(comment => ({ at: comment.created_at, key: `issue-comment ${count(comment.id)}`, line: `ISSUE_COMMENT ${count(comment.id)} #${textOf(comment.issue_url).split('/').at(-1) ?? ''}: ${oneLine(comment.body, 300)}` })),
  ]
}

export const openIssueNumbers = async (): Promise<number[]> =>
  (await allPages(`repos/${REPO}/issues?state=open&per_page=100`)).filter(issue => (issue.pull_request ?? null) === null).map(issue => count(issue.number))

export const issueLine = async (issue: number, change: 'closed' | 'reopened'): Promise<string | null> => {
  const value = record(await gh(['api', `repos/${REPO}/issues/${issue}`]))
  if (change === 'closed') {
    return `ISSUE_CLOSED #${issue} ${oneLine(value.title, 200)} (${textOf(value.state_reason) || 'closed'}, by ${textOf(record(value.closed_by).login) || '?'})`
  }
  // A brand-new issue is NEW_ISSUE's; only one that was closed before is reopened.
  return value.closed_at !== null || value.state_reason === 'reopened' ? `ISSUE_REOPENED #${issue} ${oneLine(value.title, 200)}` : null
}
