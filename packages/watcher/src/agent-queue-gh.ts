/**
 * How `agent-queue` (#354) asks GitHub. Every call, GraphQL (#402, A7 of #357) or REST (#428), is made
 * with `gh api -i`, so a refusal's limit headers can be read: on a rate limit (as reply-review-thread.ts
 * tells it) they go to stderr and the call is tried once more after waiting them out.
 */
import { type Answer, answerFrom, rateLimitWait } from './reply-review-thread'
import { record, records } from './watch-text'
import { textOf } from './read'

export const GH = process.env.GH ?? 'agent-gh'

/**
 * The environment of every `GH` call: `GH_REPO` is the repository asked about (#365), so `agent-gh`
 * picks that repository's bot from any folder; without it, outside a clone, it fails (#360).
 */
const envFor = (repo: string) => ({ ...process.env, GH_REPO: repo })

/** What `gh api -i` prints for `args`, whatever its exit code: the answer says what went wrong. */
const ghAnswer = async (repo: string, args: readonly string[]): Promise<string> => {
  const call = Bun.spawn([GH, ...args], { env: envFor(repo), stderr: 'inherit', stdout: 'pipe' })
  const [out] = await Promise.all([new Response(call.stdout).text(), call.exited])
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
export const graphqlAnswer = async (repo: string, fields: readonly string[]): Promise<Answer> =>
  limitedAnswer(repo, ['api', 'graphql', '-i', ...fields])

/** GitHub's answer to a REST read of `path` (one page: `gh api -i` can't paginate and parse), a rate limit waited out once. */
export const restAnswer = async (repo: string, path: string): Promise<Answer> => limitedAnswer(repo, ['api', '-i', path])

/** What GitHub refused in an answer; '' when it refused nothing. */
export const errorsOf = (answer: Answer): string => {
  const errors = records(record(answer.body).errors).map(error => textOf(error.message)).join('; ')
  return answer.status === 200 ? errors : `HTTP ${answer.status}: ${errors || textOf(record(answer.body).message)}`
}
