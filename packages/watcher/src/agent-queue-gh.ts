/**
 * How `agent-queue` (#354) asks GitHub. Every call, GraphQL (#402, A7 of #357) or REST (#428), is made
 * with `gh api -i`, so a refusal's limit headers can be read: on a rate limit (as reply-review-thread.ts
 * tells it) they go to stderr and the call is tried once more after waiting them out. A write answered
 * with a 5xx is checked before it is tried once more (#577).
 */
import { type Answer, answerFrom, rateLimitWait } from './reply-review-thread'
import { at, record, records } from './watch-text'
import { ghCall } from './gh-call'
import { textOf } from './read'

export const GH = process.env.GH ?? 'agent-gh'

/**
 * The environment of every `GH` call: `GH_REPO` is the repository asked about (#365), so `agent-gh`
 * picks that repository's bot from any folder; without it, outside a clone, it fails (#360).
 */
const envFor = (repo: string) => ({ ...process.env, GH_REPO: repo })

/** What `gh api -i` prints for `args`, whatever its exit code: the answer says what went wrong. Throws when it runs out of time (#540). */
const ghAnswer = async (repo: string, args: readonly string[]): Promise<string> => {
  const { out } = await ghCall(GH, args, envFor(repo))
  return out
}

const LIMIT_HEADERS = ['x-ratelimit-remaining', 'x-ratelimit-reset', 'x-ratelimit-resource', 'retry-after']

/** A refusal's status and limit headers, for the log. */
const limitsOf = (answer: Answer): string => {
  const limits = LIMIT_HEADERS.map(name => `${name}: ${answer.headers.get(name) ?? '-'}`)
  return `HTTP ${answer.status}; ${limits.join(', ')}`
}

/** GitHub's answer to a `gh api -i` call with these `args`; a rate limit is logged, and waited out once. */
const limitedAnswer = async (repo: string, args: readonly string[], retried = false): Promise<Answer> => {
  const answer = answerFrom(await ghAnswer(repo, args))
  const wait = rateLimitWait(answer, Math.floor(Temporal.Now.instant().epochMilliseconds / 1000))
  if (wait === null) {
    return answer
  }
  if (retried) {
    process.stderr.write(`Rate limited again (${limitsOf(answer)})\n`)
    return answer
  }
  process.stderr.write(`Rate limited (${limitsOf(answer)}); trying once more in ${Math.ceil(wait / 1000)} s\n`)
  await Bun.sleep(wait)
  return limitedAnswer(repo, args, true)
}

/** GitHub's answer to a GraphQL call with these `gh api` fields, a rate limit waited out once. */
const graphqlAnswer = async (repo: string, fields: readonly string[]): Promise<Answer> =>
  limitedAnswer(repo, ['api', 'graphql', '-i', ...fields])

/** GitHub's answer to a REST read of `path` (one page: `gh api -i` can't paginate and parse), a rate limit waited out once. */
export const restAnswer = async (repo: string, path: string): Promise<Answer> => limitedAnswer(repo, ['api', '-i', path])

/** What GitHub refused in an answer; '' when it refused nothing. */
const errorsOf = (answer: Answer): string => {
  const errors = records(record(answer.body).errors).map(error => textOf(error.message)).join('; ')
  return answer.status === 200 ? errors : `HTTP ${answer.status}: ${errors || textOf(record(answer.body).message)}`
}

/** The `data` of a GraphQL answer to `query` for the PR, with `extra` variables (strings). */
export const askGraphql = async ({ extra = [], pr, query, repo }: { extra?: readonly string[], pr: number, query: string, repo: string }): Promise<unknown> => {
  const [owner = '', name = ''] = repo.split('/')
  const fields = ['-f', `query=${query}`, '-f', `owner=${owner}`, '-f', `name=${name}`, '-F', `pr=${pr}`, ...extra.flatMap(variable => ['-f', variable])]
  const answer = await graphqlAnswer(repo, fields)
  const errors = errorsOf(answer)
  if (errors !== '') {
    throw new Error(`${GH} api graphql failed: ${errors}`)
  }
  return at(answer.body, 'data')
}

const LANDED_QUERY = `query($owner:String!,$name:String!,$pr:Int!){repository(owner:$owner,name:$name){pullRequest(number:$pr){
  state mergeCommit{oid} commits(last:1){nodes{commit{tree{oid}}}} baseRef{target{... on Commit{history(first:20){nodes{oid messageHeadline tree{oid}}}}}}}}}`

/**
 * The commit among the base branch's newest twenty that is the PR's squash (#577): the head's tree, or a
 * headline ending in `(#<pr>)` as GitHub's squash titles do; '' when none is.
 */
const squashOf = (pullRequest: unknown, pr: number): string => {
  const tree = textOf(at(records(at(pullRequest, 'commits', 'nodes'))[0], 'commit', 'tree', 'oid'))
  const commits = records(at(pullRequest, 'baseRef', 'target', 'history', 'nodes'))
  const squash = commits.find(commit => (tree !== '' && textOf(at(commit, 'tree', 'oid')) === tree) || textOf(commit.messageHeadline).endsWith(`(#${pr})`))
  return textOf(squash?.oid)
}

/**
 * After a write GitHub answered with a 5xx (#577), whether it went through anyway: GitHub once answered a
 * merge with a 502, landed the squash on main and left the PR open (#574). Exits when the PR is merged
 * (0), and throws when its squash is on the base branch, so the caller closes it instead of queueing it
 * again; returns, to try once more, when neither is.
 */
const checkLanded = async (repo: string, pr: number, status: number): Promise<void> => {
  const name = `${repo}#${pr}`
  const pullRequest = record(at(await askGraphql({ pr, query: LANDED_QUERY, repo }), 'repository', 'pullRequest'))
  if (pullRequest.state === 'MERGED') {
    process.stdout.write(`Merged: ${name} is merged as ${textOf(at(pullRequest, 'mergeCommit', 'oid'))} (GitHub answered HTTP ${status} first).\n`)
    process.exit(0)
  }
  const landed = squashOf(pullRequest, pr)
  if (landed !== '') {
    throw new Error(`Not queued again: ${name} landed on main as ${landed}, but GitHub didn't mark the PR merged (it answered HTTP ${status}). Close the PR as landed.`)
  }
  process.stderr.write(`GitHub answered HTTP ${status}, and ${name} isn't on main: trying once more.\n`)
}

/** A GraphQL mutation's data and what GitHub refused; a 5xx is tried once more, unless the write went through anyway (#577). */
export const mutate = async ({ mutation, pr, repo, variables }: { mutation: string, pr: number, repo: string, variables: readonly string[] }, retried = false): Promise<{ data: unknown, errors: string }> => {
  const answer = await graphqlAnswer(repo, ['-f', `query=${mutation}`, ...variables.flatMap(variable => ['-f', variable])])
  if (answer.status >= 500 && !retried) {
    await checkLanded(repo, pr, answer.status)
    return mutate({ mutation, pr, repo, variables }, true)
  }
  return { data: at(answer.body, 'data'), errors: errorsOf(answer) }
}
