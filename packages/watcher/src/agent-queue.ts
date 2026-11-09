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
 * It queues (one `enablePullRequestAutoMerge` mutation, squash, pinned to the head it checked, #357;
 * a merge queue takes it from there) only when the PR is open
 * and no draft; CI on the head has finished and passed, with at least one GitHub Actions workflow's
 * check that succeeded (another app's check, or a workflow that skipped, isn't CI, #342); GitHub
 * answered every list whole (over a hundred checks, labels, reviews or threads stops it); it is cleared, by the owner's
 * approval (their latest approval, change request or dismissal is an approval: it stays through later pushes)
 * or by the `subagent-cleared` label the owner or the bot put on after a clean review, since the last
 * push (#327, #331); no review
 * thread is open; no reviewer's latest review requests changes; and no review bot's review asked for,
 * with the `bot-review` label or a `@<bot> review` comment, is still to come (#324, #325). Otherwise it prints what blocks it and exits 1.
 * A PR with auto-merge on, or in the merge queue, is left as it is (exit 0), unless its request is
 * stuck (#544): every rule above holds, GitHub calls it CLEAN, it isn't in the queue, and nothing has
 * happened on it for NOT_QUEUED_MINUTES, the watcher's own wait, so GitHub has had its time. Then it
 * is added to the queue (or merged, on a branch without one), pinned to the head it checked; when GitHub
 * refuses that, the command fails and says so. Whether a PR is
 * user-facing it can't tell: an agent queues a user-facing PR only after the owner's approval, as
 * before, and the label goes only on PRs that aren't.
 *
 * It asks only as a bot: when GitHub's `viewer` isn't a `[bot]` login it stops before queueing (#365).
 * Every `GH` call gets the repository as `GH_REPO`, so it runs from any folder, not only a clone.
 *
 * Settings: `GH`, the `gh` to ask with, `agent-gh` (the bot) by default; `OWNER`, whose approval
 * counts, by default the repository's owner or, for an organisation, its one human admin (#295).
 * `CLEARED_LABEL` and `BOT_REVIEW_LABEL` as for the watcher. `AGENT_GH_TIMEOUT_SECONDS`, how long one call
 * may take (120 by default): one that runs out fails the command, which queues nothing after it (#540). A variable set before the command keeps
 * the allow rule from matching, so the defaults are what agents use.
 */
import { type Ask, type Check, type PrFacts, type ReviewStance, factsFrom } from './agent-queue-facts'
import { CLEARED_LABEL, clearedAt } from './watch-cleared-events'
import { GH, errorsOf, graphqlAnswer } from './agent-queue-gh'
import { at, record, records } from './watch-text'
import { BOT_REVIEW_LABEL } from './watch-bot-review-events'
import { bare } from './watch-review-events'
import { checksPassed } from './watch-ci-state'
import { NOT_QUEUED_MINUTES } from './watch-queue-events'
import { ownerOf } from './agent-queue-owner'
import { textOf } from './read'

const STILL_RUNNING = new Set(['EXPECTED', 'IN_PROGRESS', 'PENDING', 'QUEUED', 'REQUESTED', 'WAITING'])
const STANCES = new Set(['APPROVED', 'CHANGES_REQUESTED'])

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
const latestStances = (reviews: readonly ReviewStance[]): Map<string, string> => new Map(reviews
  .filter(review => STANCES.has(review.state) || review.state === 'DISMISSED')
  .map(review => [review.login.toLowerCase(), review.state]))

/**
 * Whether the owner's approval or the cleared label lets it be queued; the reason when neither does.
 * The label counts only as the watcher counts it (#327, #331): put on by the owner or the bot asking
 * (`self`), and not taken off since; and, unlike the owner's approval, only when it went on after the
 * head's last push, since nothing takes it off when a commit comes.
 */
const clearanceBlockers = (facts: PrFacts, owner: string): string[] => {
  const ownerStance = facts.reviews.findLast(review => review.login.toLowerCase() === owner.toLowerCase() && (STANCES.has(review.state) || review.state === 'DISMISSED'))
  if (ownerStance?.state === 'APPROVED') {
    return []
  }
  const labelledAt = facts.labels.includes(CLEARED_LABEL) ? clearedAt(facts.labelEvents, [owner, facts.self]) : ''
  if (labelledAt === '') {
    return [`Not cleared: no approval of ${owner}'s, and no ${CLEARED_LABEL} label put on by ${owner} or ${facts.self}.`]
  }
  if (facts.lastPush === '') {
    return [`Can't tell when the head was last pushed (no CI run for its branch on it), so ${CLEARED_LABEL} doesn't clear it.`]
  }
  return labelledAt > facts.lastPush ? [] : [`Cleared (${CLEARED_LABEL}) before the last push: clear it again.`]
}

/**
 * Bot reviews still to come: asked with the label and not yet asked on the PR, or asked with a comment
 * that no review of the bot's has followed. One in progress shows as its check still running.
 */
const botReviewBlockers = (facts: PrFacts): string[] => {
  const answered = (ask: Ask) => facts.reviews.some(review => bare(review.login) === ask.bot && review.at > ask.at)
  return [
    ...facts.labels.includes(BOT_REVIEW_LABEL) ? [`A review bot's review was asked for (${BOT_REVIEW_LABEL}) and hasn't started.`] : [],
    ...facts.asked.filter(ask => !answered(ask)).map(({ bot }) => `${bot} was asked to review (@${bot} review) and hasn't yet.`),
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

/**
 * Whether GitHub should have queued this PR by now and hasn't (#544). Waiting for checks or an approval
 * is what an auto-merge request is for, and a few minutes' delay is GitHub being slow: counted from
 * `settledAt`, not the request, as an old request whose approval just came is as young as the approval.
 */
export const autoMergeStuck = (facts: PrFacts, owner: string, now: Temporal.Instant): boolean =>
  facts.autoMerge && !facts.queued && facts.mergeState === 'CLEAN' && facts.settledAt !== '' && blockersOf(facts, owner).length === 0
  && Temporal.Instant.from(facts.settledAt).until(now).total('minutes') >= NOT_QUEUED_MINUTES

// `kind: __typename` aliases GraphQL's type name to the name clearedAt reads (actors too: `Bot`).
const LABEL_FIELDS = 'createdAt actor{kind: __typename login} label{name}'
const PR_QUERY = `query($owner:String!,$name:String!,$pr:Int!){viewer{login} repository(owner:$owner,name:$name){pullRequest(number:$pr){
  id headRefOid headRefName isMergeQueueEnabled timelineItems(itemTypes:[LABELED_EVENT,UNLABELED_EVENT,HEAD_REF_FORCE_PUSHED_EVENT],last:100){pageInfo{hasPreviousPage} nodes{kind: __typename
    ... on LabeledEvent{${LABEL_FIELDS}} ... on UnlabeledEvent{${LABEL_FIELDS}} ... on HeadRefForcePushedEvent{createdAt}}}
  state isDraft isInMergeQueue mergeStateStatus autoMergeRequest{enabledAt} labels(first:100){nodes{name} pageInfo{hasNextPage}}
  reviews(last:100){nodes{author{login} state submittedAt} pageInfo{hasPreviousPage}} comments(last:100){nodes{body createdAt} pageInfo{hasPreviousPage startCursor}} reviewThreads(first:100){nodes{isResolved} pageInfo{hasNextPage}}
  commits(last:1){nodes{commit{committedDate statusCheckRollup{contexts(first:100){pageInfo{hasNextPage} nodes{
    ... on CheckRun{name status conclusion completedAt checkSuite{createdAt branch{name} workflowRun{event}}} ... on StatusContext{context state createdAt}}}}}}}}}}`

const COMMENTS_QUERY = `query($owner:String!,$name:String!,$pr:Int!,$before:String!){repository(owner:$owner,name:$name){pullRequest(number:$pr){
  comments(last:100,before:$before){nodes{body createdAt} pageInfo{hasPreviousPage startCursor}}}}}`

/** The `data` of a GraphQL answer to `query` for the PR, with `extra` variables (strings). */
const ask = async ({ extra = [], pr, query, repo }: { extra?: readonly string[], pr: number, query: string, repo: string }): Promise<unknown> => {
  const [owner = '', name = ''] = repo.split('/')
  const fields = ['-f', `query=${query}`, '-f', `owner=${owner}`, '-f', `name=${name}`, '-F', `pr=${pr}`, ...extra.flatMap(variable => ['-f', variable])]
  const answer = await graphqlAnswer(repo, fields)
  const errors = errorsOf(answer)
  if (errors !== '') {
    throw new Error(`${GH} api graphql failed: ${errors}`)
  }
  return at(answer.body, 'data')
}

/** The PR's comments before the page `comments` (oldest first), a hundred at a time, so no `@<bot> review` is missed. */
const earlierComments = async (repo: string, pr: number, comments: unknown): Promise<unknown[]> => {
  if (at(comments, 'pageInfo', 'hasPreviousPage') !== true) {
    return []
  }
  const before = textOf(at(comments, 'pageInfo', 'startCursor'))
  const page = at(await ask({ extra: [`before=${before}`], pr, query: COMMENTS_QUERY, repo }), 'repository', 'pullRequest', 'comments')
  return [...await earlierComments(repo, pr, page), ...records(at(page, 'nodes'))]
}

/** The PR's facts, asked of GitHub in one GraphQL call, and more for comments past the first hundred. */
const readFacts = async (repo: string, pr: number): Promise<PrFacts> => {
  const data = await ask({ pr, query: PR_QUERY, repo })
  const answer = record(at(data, 'repository', 'pullRequest'))
  const nodes = [...await earlierComments(repo, pr, answer.comments), ...records(at(answer, 'comments', 'nodes'))]
  return factsFrom({ ...answer, comments: { nodes } }, textOf(at(data, 'viewer', 'login')))
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

/** A GraphQL mutation's data and what GitHub refused. */
const mutate = async ({ mutation, repo, variables }: { mutation: string, repo: string, variables: readonly string[] }): Promise<{ data: unknown, errors: string }> => {
  const answer = await graphqlAnswer(repo, ['-f', `query=${mutation}`, ...variables.flatMap(variable => ['-f', variable])])
  return { data: at(answer.body, 'data'), errors: errorsOf(answer) }
}

// One mutation each (#357): `gh pr merge --auto` reads the PR again first and kept running into the
// rate limit. `expectedHeadOid` pins the head that was checked: a push since makes GitHub refuse it.
const autoMergeMutation = (method: string) => `mutation($id:ID!,$head:GitObjectID!){enablePullRequestAutoMerge(input:{pullRequestId:$id,expectedHeadOid:$head${method}}){clientMutationId}}`
const MERGE_NOW = 'mutation($id:ID!,$head:GitObjectID!){mergePullRequest(input:{pullRequestId:$id,expectedHeadOid:$head,mergeMethod:SQUASH}){clientMutationId}}'

/**
 * Turns on auto-merge (squash; a merge queue's own method where the branch has one), and says what it
 * did. A PR GitHub would merge at once can't get auto-merge ("clean status"): it is merged, squashed,
 * as `gh pr merge --auto` does. Throws with GitHub's reasons when it refuses.
 */
const queue = async (repo: string, facts: PrFacts): Promise<string> => {
  const variables = [`id=${facts.id}`, `head=${facts.head}`]
  const auto = await mutate({ mutation: autoMergeMutation(facts.mergeQueue ? '' : ',mergeMethod:SQUASH'), repo, variables })
  if (auto.errors === '') {
    return facts.mergeQueue ? 'Set to join the merge queue:' : 'Auto-merge (squash) is on for'
  }
  if (!/clean status/iu.test(auto.errors)) {
    throw new Error(`GitHub refused auto-merge: ${auto.errors}`)
  }
  const now = await mutate({ mutation: MERGE_NOW, repo, variables })
  if (now.errors !== '') {
    throw new Error(`GitHub refused the merge: ${now.errors}`)
  }
  return 'Merged (squash, it was ready):'
}

const ENQUEUE = 'mutation($id:ID!,$head:GitObjectID!){enqueuePullRequest(input:{pullRequestId:$id,expectedHeadOid:$head}){clientMutationId}}'

/** Gets a PR whose auto-merge request is stuck (#544) into the queue, or merged on a branch without one, and says which. Throws with GitHub's reasons when it refuses. */
const unstick = async (repo: string, facts: PrFacts): Promise<string> => {
  const mutation = facts.mergeQueue ? ENQUEUE : MERGE_NOW
  const { errors } = await mutate({ mutation, repo, variables: [`id=${facts.id}`, `head=${facts.head}`] })
  if (errors !== '') {
    const stuck = `Its auto-merge request is stuck: CLEAN, approved and green, but ${facts.mergeQueue ? 'still not in the merge queue' : 'still not merged'}.`
    throw new Error(`${stuck} GitHub refused to ${facts.mergeQueue ? 'queue' : 'merge'} it: ${errors}`)
  }
  return facts.mergeQueue ? 'Added to the merge queue (its auto-merge request was stuck):' : 'Merged (squash, its auto-merge request was stuck):'
}

/** Says why it isn't queued, and exits 1, when `blockers` holds anything. */
const refuseFor = (name: string, blockers: readonly string[]): void => {
  if (blockers.length > 0) {
    const lines = blockers.map(line => `- ${line}`)
    process.stdout.write([`Not queued: ${name} may not be queued yet.`, ...lines, ''].join('\n'))
    process.exit(1)
  }
}

/**
 * Stops unless GitHub's `viewer` is a bot (#365): an agent queues as its bot, never with the owner's
 * login, which `agent-gh` once fell back to outside a clone (#360).
 */
const askAsBot = (self: string): void => {
  if (!self.endsWith('[bot]')) {
    throw new Error(`Not queued: ${GH} asks as ${self || 'nobody'}, not as a bot (a [bot] login). Fix ${GH}, then try again.`)
  }
}

const main = async (): Promise<void> => {
  const { pr, repo } = argsOf()
  // The owner first: its read can wait out a rate limit, and the facts must be as of the decision (#428).
  const owner = await ownerOf(repo)
  const facts = await readFacts(repo, pr)
  askAsBot(facts.self)
  if (autoMergeStuck(facts, owner, Temporal.Now.instant())) {
    process.stdout.write(`${await unstick(repo, facts)} ${repo}#${pr} at ${facts.head.slice(0, 7)}.\n`)
    return
  }
  if (facts.state === 'OPEN' && (facts.autoMerge || facts.queued)) {
    const where = facts.queued ? 'in the merge queue' : 'set to auto-merge'
    process.stdout.write(`${repo}#${pr} is already ${where}.\n`)
    return
  }
  refuseFor(`${repo}#${pr}`, blockersOf(facts, owner))
  process.stdout.write(`${await queue(repo, facts)} ${repo}#${pr} at ${facts.head.slice(0, 7)}.\n`)
}

if (import.meta.main) {
  await main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exit(2)
  })
}
