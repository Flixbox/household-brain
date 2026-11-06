/**
 * Queues a pull request, but only once the queueing rules let it (#354):
 *
 *   agent-queue <owner/name> <pr>
 *
 * It replaces agents running `agent-gh pr merge <n> --auto --squash` themselves. Claude Code's
 * permission rules match a Bash command's text: an allow rule for that merge form misses it once the
 * call is chained (`cd … &&`, `| tail`, a second command after `;`) or its flags move, and the
 * auto-mode classifier then judges the merge afresh and refuses it at times ("Merge Without Review").
 * This command takes its repository as an argument, so it needs no `cd`, prints a short answer, so it
 * needs no pipe, and checks the rules itself, so one allow rule (`Bash(agent-queue *)`) can let it
 * through without a judgement. Run it alone in its own call, with nothing before or after it.
 *
 * It queues (`pr merge --auto --squash`, which also enters a merge queue) only when the PR is open
 * and no draft; CI on the head has finished and passed, with at least one GitHub Actions workflow's
 * check that succeeded (another app's check, or a workflow that skipped, isn't CI, #342); GitHub
 * answered every list whole (over a hundred checks, labels, reviews or threads stops it); it is cleared, by the owner's
 * approval (their latest approval or change request is an approval: it stays through later pushes)
 * or by the `subagent-cleared` label the main session puts on after a clean review (#327); no review
 * thread is open; no reviewer's latest review requests changes; and no review bot's review asked for,
 * with the `bot-review` label or a `@<bot> review` comment, is still to come (#324, #325). Otherwise it prints what blocks it and exits 1.
 * A PR with auto-merge on, or in the merge queue, is left as it is (exit 0). Whether a PR is
 * user-facing it can't tell: an agent queues a user-facing PR only after the owner's approval, as
 * before, and the label goes only on PRs that aren't.
 *
 * Settings: `GH`, the `gh` to ask with, `agent-gh` (the bot) by default; `OWNER`, whose approval
 * counts, by default the repository's owner or, for an organisation, its one human admin (#295).
 * `CLEARED_LABEL` and `BOT_REVIEW_LABEL` as for the watcher. A variable set before the command keeps
 * the allow rule from matching, so the defaults are what agents use.
 */
import { type Json, actor, at, record, records } from './watch-text'
import { hasText, isRecord, textOf } from './read'
import { BOT_REVIEW_LABEL } from './watch-bot-review-events'
import { CLEARED_LABEL } from './watch-cleared-events'
import { bare } from './watch-review-events'
import { checksPassed } from './watch-ci-state'
import { defaultOwner } from './watch-owner'

/** One check on the PR's head: its name, its result (a conclusion, or PENDING while it runs), and whether a workflow ran it. */
export interface Check {
  name: string
  result: string
  workflow: boolean
}

/** One review, oldest first. */
export interface Review {
  login: string
  state: string
}

/** What decides whether a PR may be queued. */
export interface PrFacts {
  /** The bots someone asked with a `@<bot> review` comment (#324, #325), in `bare` form, from all its comments. */
  asked: readonly string[]
  autoMerge: boolean
  checks: readonly Check[]
  draft: boolean
  labels: readonly string[]
  openThreads: number
  queued: boolean
  reviews: readonly Review[]
  state: string
  truncated: boolean
}

const STILL_RUNNING = new Set(['EXPECTED', 'IN_PROGRESS', 'PENDING', 'QUEUED', 'REQUESTED', 'WAITING'])
const STANCES = new Set(['APPROVED', 'CHANGES_REQUESTED'])

/** A check run's or commit status's part of the rollup, as a `Check`. */
const checkFrom = (node: Json): Check => {
  if (hasText(textOf(node.context))) {
    return { name: textOf(node.context), result: textOf(node.state, 'PENDING'), workflow: false }
  }
  const result = node.status === 'COMPLETED' ? textOf(node.conclusion, 'PENDING') : 'PENDING'
  return { name: textOf(node.name), result, workflow: isRecord(at(node, 'checkSuite', 'workflowRun')) }
}

/** The bots a `@<bot> review` comment asked (CodeRabbit's documented trigger, as the watcher posts it), in `bare` form. */
const askedBots = (comments: readonly Json[]): string[] => [...new Set(comments
  .map(comment => /^@(?<bot>[\w-]+(?:\[bot\])?) review$/iu.exec(textOf(comment.body).trim())?.groups?.bot ?? '')
  .filter(bot => bot !== '')
  .map(bot => bare(bot)))]

/** Whether one of the lists GitHub answered with has more than it sent: then a check, review or thread may be missing. */
const truncatedIn = (pr: unknown, contexts: unknown): boolean => [
  at(contexts, 'pageInfo', 'hasNextPage'),
  at(pr, 'labels', 'pageInfo', 'hasNextPage'),
  at(pr, 'reviewThreads', 'pageInfo', 'hasNextPage'),
  at(pr, 'reviews', 'pageInfo', 'hasPreviousPage'),
].some(more => more === true)

/** The facts in GitHub's answer for one `pullRequest` (`PR_QUERY`). */
export const factsFrom = (pr: unknown): PrFacts => {
  const [head] = records(at(pr, 'commits', 'nodes'))
  const contexts = at(head, 'commit', 'statusCheckRollup', 'contexts')
  const fields = record(pr)
  return {
    asked: askedBots(records(at(pr, 'comments', 'nodes'))),
    autoMerge: isRecord(fields.autoMergeRequest),
    checks: records(at(contexts, 'nodes')).map(node => checkFrom(node)),
    draft: fields.isDraft === true,
    labels: records(at(pr, 'labels', 'nodes')).map(label => textOf(label.name)),
    openThreads: records(at(pr, 'reviewThreads', 'nodes')).filter(thread => thread.isResolved !== true).length,
    queued: fields.isInMergeQueue === true,
    reviews: records(at(pr, 'reviews', 'nodes')).map(review => ({ login: actor(review.author), state: textOf(review.state) })),
    state: textOf(fields.state),
    truncated: truncatedIn(pr, contexts),
  }
}

const names = (checks: readonly Check[]) => checks.map(check => check.name).join(', ')

/** What CI on the head still lacks: a workflow's check that passed (one that ran nothing proves nothing), checks still running, or failed ones. */
const ciBlockers = (checks: readonly Check[]): string[] => {
  const running = checks.filter(check => STILL_RUNNING.has(check.result))
  const failed = checks.filter(check => !STILL_RUNNING.has(check.result) && !checksPassed([check.result]))
  return [
    ...checks.some(check => check.workflow && check.result === 'SUCCESS') ? [] : ["CI hasn't reported on the head yet."],
    ...running.length > 0 ? [`CI still runs: ${names(running)}.`] : [],
    ...failed.length > 0 ? [`CI failed: ${names(failed)}.`] : [],
  ]
}

/** Each reviewer's latest review that takes a stance (approves, requests changes or was dismissed). */
const latestStances = (reviews: readonly Review[]): Map<string, string> => new Map(reviews
  .filter(review => STANCES.has(review.state) || review.state === 'DISMISSED')
  .map(review => [review.login.toLowerCase(), review.state]))

/** Whether the owner's approval or the cleared label lets it be queued; the reason when neither does. */
const clearanceBlockers = (facts: PrFacts, owner: string): string[] => {
  const ownerStance = facts.reviews.findLast(review => review.login.toLowerCase() === owner.toLowerCase() && STANCES.has(review.state))
  const cleared = ownerStance?.state === 'APPROVED' || facts.labels.includes(CLEARED_LABEL)
  return cleared ? [] : [`Not cleared: no approval of ${owner}'s and no ${CLEARED_LABEL} label.`]
}

/**
 * Bot reviews still to come: asked with the label and not yet asked on the PR, or asked with a comment
 * and not yet given. The watcher asks a bot only while it never reviewed the PR, so any review of its
 * is the one asked for (watch-bot-review-events.ts). One in progress shows as its check still running.
 */
const botReviewBlockers = (facts: PrFacts): string[] => {
  const reviewed = new Set(facts.reviews.map(review => bare(review.login)))
  return [
    ...facts.labels.includes(BOT_REVIEW_LABEL) ? [`A review bot's review was asked for (${BOT_REVIEW_LABEL}) and hasn't started.`] : [],
    ...facts.asked.filter(bot => !reviewed.has(bot)).map(bot => `${bot} was asked to review (@${bot} review) and hasn't yet.`),
  ]
}

/** Open threads, change requests still standing, and a bot review still to come. */
const reviewBlockers = (facts: PrFacts): string[] => {
  const requesters = [...latestStances(facts.reviews)].filter(([, state]) => state === 'CHANGES_REQUESTED')
  const loginOf = (lower: string) => facts.reviews.find(review => review.login.toLowerCase() === lower)?.login ?? lower
  const threads = facts.openThreads === 1 ? '1 review thread is open.' : `${facts.openThreads} review threads are open.`
  return [
    ...facts.openThreads > 0 ? [threads] : [],
    ...requesters.map(([login]) => `${loginOf(login)} requests changes.`),
    ...botReviewBlockers(facts),
  ]
}

/** Why the PR may not be queued yet; none when it may. `owner` is the login whose approval counts. */
export const blockersOf = (facts: PrFacts, owner: string): string[] => {
  if (facts.state !== 'OPEN') {
    return [`It is ${facts.state.toLowerCase()}, not open.`]
  }
  return [
    ...facts.truncated ? ["GitHub's answer was cut off (over a hundred checks, labels, reviews or threads): check it by hand."] : [],
    ...facts.draft ? ['It is a draft.'] : [],
    ...ciBlockers(facts.checks),
    ...clearanceBlockers(facts, owner),
    ...reviewBlockers(facts),
  ]
}

const GH = process.env.GH ?? 'agent-gh'

/** What `gh` prints for `args`; throws with its exit code when it fails. Its stderr goes straight through. */
const gh = async (args: readonly string[]): Promise<string> => {
  const call = Bun.spawn([GH, ...args], { stderr: 'inherit', stdout: 'pipe' })
  const out = await new Response(call.stdout).text()
  const code = await call.exited
  if (code !== 0) {
    throw new Error(`${GH} ${args.slice(0, 2).join(' ')} failed (exit ${code})`)
  }
  return out
}

const PR_QUERY = `query($owner:String!,$name:String!,$pr:Int!){repository(owner:$owner,name:$name){pullRequest(number:$pr){
  state isDraft isInMergeQueue autoMergeRequest{enabledAt} labels(first:100){nodes{name} pageInfo{hasNextPage}}
  reviews(last:100){nodes{author{login} state} pageInfo{hasPreviousPage}} comments(last:100){nodes{body} pageInfo{hasPreviousPage startCursor}} reviewThreads(first:100){nodes{isResolved} pageInfo{hasNextPage}}
  commits(last:1){nodes{commit{statusCheckRollup{contexts(first:100){pageInfo{hasNextPage} nodes{
    ... on CheckRun{name status conclusion checkSuite{workflowRun{databaseId}}} ... on StatusContext{context state}}}}}}}}}}`

const COMMENTS_QUERY = `query($owner:String!,$name:String!,$pr:Int!,$before:String!){repository(owner:$owner,name:$name){pullRequest(number:$pr){
  comments(last:100,before:$before){nodes{body} pageInfo{hasPreviousPage startCursor}}}}}`

/** The `pullRequest` of a GraphQL answer to `query` for the PR, with `extra` variables (strings). */
const askPr = async ({ extra = [], pr, query, repo }: { extra?: readonly string[], pr: number, query: string, repo: string }): Promise<unknown> => {
  const [owner = '', name = ''] = repo.split('/')
  const args = ['api', 'graphql', '-f', `query=${query}`, '-f', `owner=${owner}`, '-f', `name=${name}`, '-F', `pr=${pr}`, ...extra.flatMap(variable => ['-f', variable])]
  return at(JSON.parse(await gh(args)), 'data', 'repository', 'pullRequest')
}

/** The PR's comments before the page `comments` (oldest first), a hundred at a time, so no `@<bot> review` is missed. */
const earlierComments = async (repo: string, pr: number, comments: unknown): Promise<unknown[]> => {
  if (at(comments, 'pageInfo', 'hasPreviousPage') !== true) {
    return []
  }
  const before = textOf(at(comments, 'pageInfo', 'startCursor'))
  const page = at(await askPr({ extra: [`before=${before}`], pr, query: COMMENTS_QUERY, repo }), 'comments')
  return [...await earlierComments(repo, pr, page), ...records(at(page, 'nodes'))]
}

/** The PR's facts, asked of GitHub in one GraphQL call, and more for comments past the first hundred. */
const readFacts = async (repo: string, pr: number): Promise<PrFacts> => {
  const answer = record(await askPr({ pr, query: PR_QUERY, repo }))
  const nodes = [...await earlierComments(repo, pr, answer.comments), ...records(at(answer, 'comments', 'nodes'))]
  return factsFrom({ ...answer, comments: { nodes } })
}

/** OWNER, else `defaultOwner` for the repository (its note goes to stderr). */
const ownerOf = async (repo: string): Promise<string> => {
  if (hasText(process.env.OWNER)) {
    return process.env.OWNER
  }
  const [repoOwner = ''] = repo.split('/')
  const organisation = await gh(['api', `repos/${repo}`, '-q', '.owner.type']).then(text => text.trim() === 'Organization', () => null)
  const humanAdmins = organisation === true
    ? await gh(['api', '--paginate', `repos/${repo}/collaborators?permission=admin`, '-q', '.[] | select(.type == "User") | .login'])
      .then(text => text.split('\n').filter(line => line !== ''), () => null)
    : []
  const { note, owner } = defaultOwner(repoOwner, organisation, humanAdmins)
  if (note !== null) {
    process.stderr.write(`${note}\n`)
  }
  return owner
}

/** The command's arguments; exits with the usage when they don't fit. */
const argsOf = (): { pr: number, repo: string } => {
  const [repo = '', prText = ''] = Bun.argv.slice(2)
  const pr = Number(prText)
  if (!/^[\w.-]+\/[\w.-]+$/u.test(repo) || !Number.isInteger(pr) || pr < 1 || Bun.argv.length > 4) {
    process.stderr.write('Usage: agent-queue <owner/name> <pr>\n')
    process.exit(64)
  }
  return { pr, repo }
}

/** Says why it isn't queued, and exits 1, when `blockers` holds anything. */
const refuseFor = (name: string, blockers: readonly string[]): void => {
  if (blockers.length > 0) {
    const lines = blockers.map(line => `- ${line}`)
    process.stdout.write([`Not queued: ${name} may not be queued yet.`, ...lines, ''].join('\n'))
    process.exit(1)
  }
}

const main = async (): Promise<void> => {
  const { pr, repo } = argsOf()
  const [facts, owner] = await Promise.all([readFacts(repo, pr), ownerOf(repo)])
  if (facts.state === 'OPEN' && (facts.autoMerge || facts.queued)) {
    const where = facts.queued ? 'in the merge queue' : 'set to auto-merge'
    process.stdout.write(`${repo}#${pr} is already ${where}.\n`)
    return
  }
  refuseFor(`${repo}#${pr}`, blockersOf(facts, owner))
  await gh(['pr', 'merge', String(pr), '--repo', repo, '--auto', '--squash'])
  process.stdout.write(`Queued ${repo}#${pr}: auto-merge (squash) is on.\n`)
}

if (import.meta.main) {
  await main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exit(2)
  })
}
