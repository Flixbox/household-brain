/**
 * How `agent-queue` (#354) asks GitHub. Every call, GraphQL (#402, A7 of #357) or REST (#428), is made
 * with `gh api -i`, so a refusal's limit headers can be read: on a rate limit (as reply-review-thread.ts
 * tells it) they go to stderr and the call is tried once more after waiting them out. A write answered
 * with a 5xx is checked before it is tried once more (#577).
 */
import { type Answer, answerFrom, rateLimitWait } from './reply-review-thread'
import { type Json, at, record, records } from './watch-text'
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

const LANDED_QUERY = `query($owner:String!,$name:String!,$pr:Int!,$since:GitTimestamp!){repository(owner:$owner,name:$name){pullRequest(number:$pr){
  state mergeCommit{oid} autoMergeRequest{enabledAt} isInMergeQueue commits(last:1){nodes{commit{tree{oid}}}}
  baseRef{target{... on Commit{history(first:20,since:$since){nodes{oid messageHeadline tree{oid}}}}}}}}}`

/** How long to wait after a 5xx before reading the PR again (#579), so a write GitHub is still finishing shows. */
const waitSeconds = (): number => Number(process.env.AGENT_QUEUE_5XX_WAIT_SECONDS ?? 5)

/** "Fri, 13 Nov 2026 21:07:46 GMT", the form of an HTTP `Date` header, as an instant; null when it isn't one. */
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const httpDate = (text: string): Temporal.Instant | null => {
  const groups = /(?<day>\d{1,2}) (?<mon>\w{3}) (?<year>\d{4}) (?<hour>\d{2}):(?<minute>\d{2}):(?<second>\d{2}) GMT/u.exec(text)?.groups ?? {}
  const month = MONTHS.indexOf(groups.mon ?? '') + 1
  if (month === 0) {
    return null
  }
  const [day, year, hour, minute, second] = [groups.day, groups.year, groups.hour, groups.minute, groups.second].map(Number)
  return Temporal.ZonedDateTime.from({ day, hour, minute, month, second, timeZone: 'UTC', year }).toInstant()
}

/**
 * When GitHub got the write (#579), by its own clock, so a local clock that is off doesn't matter: the
 * answer's `Date` less the time the call took, less a second for the header's rounding; local time when
 * the answer has no date.
 */
const sentAt = (answer: Answer, sent: Temporal.Instant): Temporal.Instant => {
  const answered = httpDate(answer.headers.get('date') ?? '')
  return answered === null ? sent : answered.subtract({ milliseconds: Math.ceil(sent.until(Temporal.Now.instant()).total('milliseconds')) + 1000 })
}

/**
 * The commit on the base branch, committed since the write was sent, that is the PR's squash (#577,
 * #579): the head's tree, or a headline ending in `(#<pr>)` as GitHub's squash titles do; '' when none
 * is. An older commit with the head's tree (a PR reverting main to it) or naming the PR isn't the write's.
 */
const squashOf = (pullRequest: unknown, pr: number): string => {
  const tree = textOf(at(records(at(pullRequest, 'commits', 'nodes'))[0], 'commit', 'tree', 'oid'))
  const commits = records(at(pullRequest, 'baseRef', 'target', 'history', 'nodes'))
  const squash = commits.find(commit => (tree !== '' && textOf(at(commit, 'tree', 'oid')) === tree) || textOf(commit.messageHeadline).endsWith(`(#${pr})`))
  return textOf(squash?.oid)
}

/** Exit code when the PR's squash landed but GitHub left it open (#579), apart from the other failures' 2. */
export const LANDED_EXIT = 3

/**
 * What the write did, as far as the re-read shows (#579); '' when it didn't
 * go through. An auto-merge request counts only after an auto-merge write (`enables`): the other
 * writes run on PRs that already have one.
 */
const doneAs = ({ enables, name, pullRequest }: { enables: boolean, name: string, pullRequest: Json }): string => {
  if (pullRequest.state === 'MERGED') {
    return `Merged: ${name} is merged as ${textOf(at(pullRequest, 'mergeCommit', 'oid'))}`
  }
  if (pullRequest.state !== 'OPEN') {
    return ''
  }
  if (pullRequest.isInMergeQueue === true) {
    return `${name} is in the merge queue`
  }
  return enables && textOf(at(pullRequest, 'autoMergeRequest', 'enabledAt')) !== '' ? `${name} is set to auto-merge` : ''
}

/**
 * After a write GitHub answered with a 5xx (#577), whether it went through anyway: GitHub once answered a
 * merge with a 502, landed the squash on main and left the PR open (#574). It waits a little first
 * (#579). Exits 0 when the PR is merged, in the merge queue, or (after an auto-merge write, `enables`)
 * set to auto-merge; exits LANDED_EXIT when it is still open but its squash is on the base branch, so
 * the caller closes it instead of queueing it again; returns, to try once more, when none is so.
 */
const checkLanded = async ({ enables, pr, repo, since, status }: { enables: boolean, pr: number, repo: string, since: Temporal.Instant, status: number }): Promise<void> => {
  const name = `${repo}#${pr}`
  await Bun.sleep(waitSeconds() * 1000)
  const pullRequest = record(at(await askGraphql({ extra: [`since=${since.toString()}`], pr, query: LANDED_QUERY, repo }), 'repository', 'pullRequest'))
  const done = doneAs({ enables, name, pullRequest })
  const landed = done === '' && pullRequest.state === 'OPEN' ? squashOf(pullRequest, pr) : ''
  if (done !== '' || landed !== '') {
    const [out, line, code] = done === ''
      ? [process.stderr, `Not queued again: ${name} landed on main as ${landed}, but GitHub didn't mark the PR merged (it answered HTTP ${status}). Close the PR as landed.`, LANDED_EXIT]
      : [process.stdout, `${done} (GitHub answered HTTP ${status} first).`, 0]
    out.write(`${line}\n`)
    process.exit(code)
  }
  process.stderr.write(`GitHub answered HTTP ${status}, and ${name} isn't on main: trying once more.\n`)
}

/** A GraphQL mutation's data and what GitHub refused; a 5xx is tried once more, unless the write went through anyway (#577). */
export const mutate = async ({ mutation, pr, repo, variables }: { mutation: string, pr: number, repo: string, variables: readonly string[] }, retried = false): Promise<{ data: unknown, errors: string }> => {
  const sent = Temporal.Now.instant()
  const answer = await graphqlAnswer(repo, ['-f', `query=${mutation}`, ...variables.flatMap(variable => ['-f', variable])])
  if (answer.status >= 500 && !retried) {
    await checkLanded({ enables: mutation.includes('enablePullRequestAutoMerge'), pr, repo, since: sentAt(answer, sent), status: answer.status })
    return mutate({ mutation, pr, repo, variables }, true)
  }
  return { data: at(answer.body, 'data'), errors: errorsOf(answer) }
}
