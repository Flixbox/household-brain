/** The project watcher's questions to GitHub, through the `gh` CLI, answered as plain data. */
import { $ } from 'bun'
import { Temporal } from 'temporal-polyfill'
import type { Activity, OpenPr, Run } from './watch-events'
import { isRecord, textOf } from '@household-brain/core/lib/read'

export const REPO = process.env.REPO ?? 'Flixbox/household-brain'
const WORKFLOW = process.env.WORKFLOW ?? 'ci.yml'
// The agent runs this as its bot: GH=agent-gh (see .ai/AGENTS.md). Defaults to plain gh.
const GH = process.env.GH ?? 'gh'
// Comments are read with the owner's login: a pending (unsubmitted) review is only visible to its
// author, and the owner leaves those. Override with ACTIVITY_GH.
const ACTIVITY_GH = process.env.ACTIVITY_GH ?? 'gh'
const OWNER = process.env.OWNER ?? 'Flixbox'
// The agent's own comments and replies in review threads are not news to it. Its reviews (the
// reviewer agent posts as the same bot) still are.
const SELF = process.env.SELF ?? 'flixbox-ai-agent[bot]'
// Nx Cloud's status comment on every push needs no answer.
const IGNORED = new Set([SELF, 'nx-cloud[bot]'])

type Json = Record<string, unknown>

const records = (value: unknown): Json[] => (Array.isArray(value) ? value.filter(isRecord) : [])

/** The line a review comment is on; one on an outdated diff only has its original line. */
const lineOf = (item: Record<string, unknown>) => [item.line, item.original_line].find((value): value is number => typeof value === 'number')
const count = (value: unknown) => (typeof value === 'number' ? value : 0)
const record = (value: unknown): Json => (isRecord(value) ? value : {})
const oneLine = (value: unknown, length: number) => textOf(value).replaceAll(/\s+/gu, ' ').slice(0, length)

const gh = async (args: string[], cli = GH): Promise<unknown> => JSON.parse(await $`${cli} ${args}`.quiet().text())

/** Every item of a paged list, all pages in one array (`--slurp` wraps each page). */
const allPages = async (path: string, cli = GH): Promise<Json[]> => {
  const pages = await gh(['api', '--paginate', '--slurp', path], cli)
  return Array.isArray(pages) ? pages.flatMap(records) : []
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

export const openPrs = async (): Promise<OpenPr[]> =>
  records(await gh(['pr', 'list', '--repo', REPO, '--state', 'open', '--limit', '100', '--json', 'number,title,reviewDecision,autoMergeRequest,labels,statusCheckRollup']))
    .map(pr => ({
      autoMerge: Boolean(pr.autoMergeRequest),
      checks: records(pr.statusCheckRollup).map(check => textOf(check.conclusion) || textOf(check.state) || 'pending'),
      number: count(pr.number),
      parked: records(pr.labels).some(label => label.name === 'parked'),
      reviewDecision: textOf(pr.reviewDecision),
      title: textOf(pr.title),
    }))

export interface PrState {
  state: string
  mergeable: string
  head: string
  mergeSha: string
  decision: string
  autoMerge: boolean
  parked: boolean
  title: string
}

export const prState = async (pr: number): Promise<PrState> => {
  const value = record(await gh(['pr', 'view', String(pr), '--repo', REPO, '--json', 'state,mergeable,headRefOid,mergeCommit,reviewDecision,autoMergeRequest,labels,title,author']))
  return {
    autoMerge: Boolean(value.autoMergeRequest),
    decision: textOf(value.reviewDecision),
    head: textOf(value.headRefOid),
    mergeSha: textOf(record(value.mergeCommit).oid),
    mergeable: textOf(value.mergeable),
    parked: records(value.labels).some(label => label.name === 'parked'),
    state: textOf(value.state),
    title: `${textOf(value.title)} (by ${textOf(record(value.author).login)})`,
  }
}

/** Pull requests merged in the last `hours`. */
export const recentlyMerged = async (hours: number): Promise<number[]> => {
  const since = Temporal.Now.instant().subtract({ hours })
  return records(await gh(['pr', 'list', '--repo', REPO, '--state', 'merged', '--limit', '20', '--json', 'number,mergedAt']))
    .filter(pr => Temporal.Instant.compare(Temporal.Instant.from(textOf(pr.mergedAt)), since) > 0)
    .map(pr => count(pr.number))
}

/** Comments, reviews (not plain approvals) and review comments on a PR, the agent's own left out. */
export const activityOf = async (pr: number): Promise<Activity[]> => {
  const [comments, reviews, reviewComments] = await Promise.all([
    allPages(`repos/${REPO}/issues/${pr}/comments`, ACTIVITY_GH),
    allPages(`repos/${REPO}/pulls/${pr}/reviews`, ACTIVITY_GH),
    allPages(`repos/${REPO}/pulls/${pr}/comments`, ACTIVITY_GH),
  ])
  const login = (item: Json) => textOf(record(item.user).login)
  return [
    ...comments.filter(item => !IGNORED.has(login(item)))
      .map(item => ({ id: `comment ${count(item.id)}`, line: `comment ${count(item.id)} ${login(item)}: ${oneLine(item.body, 200)}` })),
    ...reviews.filter(item => (item.state !== 'APPROVED' || textOf(item.body) !== '') && (login(item) !== SELF || textOf(item.body) !== ''))
      .map(item => ({ id: `review ${count(item.id)}`, line: `review ${count(item.id)} ${login(item)} ${textOf(item.state)}: ${oneLine(item.body, 200)}` })),
    ...reviewComments.filter(item => login(item) !== SELF || !item.in_reply_to_id)
      .map(item => ({ id: `review-comment ${count(item.id)}`, line: `review-comment ${count(item.id)} ${login(item)} ${textOf(item.path)}: ${oneLine(item.body, 200)}` })),
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

/** New issues (not the agent's own) and the owner's comments on issues, newest first. */
export const issueEventLines = async (): Promise<string[]> => {
  const [issues, comments] = await Promise.all([
    gh(['api', `repos/${REPO}/issues?state=all&per_page=50&sort=created&direction=desc`]),
    gh(['api', `repos/${REPO}/issues/comments?per_page=50&sort=created&direction=desc`]),
  ])
  return [
    ...records(issues).filter(issue => !issue.pull_request && textOf(record(issue.user).login) !== SELF)
      .map(issue => `NEW_ISSUE #${count(issue.number)} ${textOf(issue.title)}`),
    ...records(comments).filter(comment => textOf(record(comment.user).login) === OWNER && textOf(comment.html_url).includes('/issues/'))
      .map(comment => `ISSUE_COMMENT ${count(comment.id)} #${textOf(comment.issue_url).split('/').at(-1) ?? ''}: ${oneLine(comment.body, 300)}`),
  ]
}

export const openIssueNumbers = async (): Promise<number[]> =>
  (await allPages(`repos/${REPO}/issues?state=open&per_page=100`)).filter(issue => !issue.pull_request).map(issue => count(issue.number))

export const issueLine = async (issue: number, change: 'closed' | 'reopened'): Promise<string | null> => {
  const value = record(await gh(['api', `repos/${REPO}/issues/${issue}`]))
  if (change === 'closed') {
    return `ISSUE_CLOSED #${issue} ${textOf(value.title)} (${textOf(value.state_reason) || 'closed'}, by ${textOf(record(value.closed_by).login) || '?'})`
  }
  // A brand-new issue is NEW_ISSUE's; only one that was closed before is reopened.
  return value.closed_at !== null || value.state_reason === 'reopened' ? `ISSUE_REOPENED #${issue} ${textOf(value.title)}` : null
}
