/**
 * Replies in a pull request's review thread (#297), for agents answering review comments:
 *
 *   reply-review-thread <pr> <comment-id|PRRT_id> <body>   (a body of `-` is read from stdin)
 *
 * The thread is the `PRRT_…` id given, or the one holding the comment given by its REST id (the number
 * in a comment's `#discussion_r…` link) or its `PRRC_…` node id. It replies through GraphQL's
 * `addPullRequestReviewThreadReply`, not REST's `pulls/<n>/comments/<id>/replies`: agents sharing one
 * app installation had REST replies refused with 403 "API rate limit exceeded" in a burst while the
 * hourly quota was far from used up, and GraphQL, which has its own limits, went through all along.
 *
 * A call refused for a rate limit (403 or 429 saying so, or GraphQL's `RATE_LIMITED`) is tried once
 * more after waiting: `retry-after` when GitHub sends it, else until `x-ratelimit-reset` when
 * `x-ratelimit-remaining` is 0, else a minute. Never more than once, so agents don't hammer a limit.
 *
 * Settings as the watcher's (`--env-file=.claude/watcher.env` reads them): `GH`, the `gh` to ask with
 * (the bot's `agent-gh`), and `REPO`, by default the repository of the current folder.
 */
import { hasText, isRecord, textOf } from './read'
import { type Json, record, records } from './watch-text'

/** A `gh api -i` answer: the HTTP status, the headers (names in lower case) and the parsed body. */
export interface Answer {
  body: unknown
  headers: ReadonlyMap<string, string>
  status: number
}

/** The headers of an answer, by their names in lower case. */
const headersFrom = (lines: readonly string[]): Map<string, string> => {
  const headers = new Map<string, string>()
  for (const line of lines) {
    const colon = line.indexOf(':')
    if (colon > 0) {
      headers.set(line.slice(0, colon).trim().toLowerCase(), line.slice(colon + 1).trim())
    }
  }
  return headers
}

/** An answer's body: its JSON, or the text where it is none; null when empty. */
const bodyFrom = (raw: string): unknown => {
  if (raw === '') {
    return null
  }
  try {
    return JSON.parse(raw)
  } catch {
    return raw
  }
}

/** Reads what `gh api -i` prints: a status line, the headers, an empty line, then the body. */
export const answerFrom = (text: string): Answer => {
  const [head = '', ...rest] = text.split(/\r?\n\r?\n/u)
  const [statusLine = '', ...headerLines] = head.split(/\r?\n/u)
  const status = Number(/^HTTP\/\S+\s+(?<code>\d{3})/u.exec(statusLine)?.groups?.code ?? 0)
  return { body: bodyFrom(rest.join('\n\n').trim()), headers: headersFrom(headerLines), status }
}

const MINUTE_MS = 60_000

/** Whether GitHub refused the call for a rate limit: REST's 403 or 429 saying so, or GraphQL's `RATE_LIMITED`. */
const rateLimited = ({ body, status }: Answer): boolean => {
  if (records(record(body).errors).some(error => textOf(error.type) === 'RATE_LIMITED')) {
    return true
  }
  const message = isRecord(body) ? textOf(body.message) : textOf(body)
  return status === 429 || (status === 403 && /rate limit/iu.test(message))
}

/**
 * How long to wait before the one retry of a call GitHub refused for a rate limit, in milliseconds;
 * null when it wasn't refused for one. `nowSeconds` is the current time in epoch seconds.
 */
export const rateLimitWait = (answer: Answer, nowSeconds: number): number | null => {
  if (!rateLimited(answer)) {
    return null
  }
  const retryAfter = Number(answer.headers.get('retry-after') ?? Number.NaN)
  if (Number.isFinite(retryAfter) && retryAfter >= 0) {
    return retryAfter * 1000
  }
  const reset = Number(answer.headers.get('x-ratelimit-reset') ?? Number.NaN)
  if (answer.headers.get('x-ratelimit-remaining') === '0' && Number.isFinite(reset)) {
    return Math.max(0, reset - nowSeconds) * 1000
  }
  return MINUTE_MS
}

/** A review thread's node id and its comments' ids, REST's (`databaseId`) and GraphQL's (`PRRC_…`). */
export interface Thread {
  commentIds: readonly string[]
  id: string
}

/** The id of the thread `target` names: a `PRRT_…` id itself, else the thread holding that comment; null when none does. */
export const threadIdOf = (target: string, threads: readonly Thread[]): string | null =>
  target.startsWith('PRRT_') ? target : threads.find(thread => thread.commentIds.includes(target))?.id ?? null

/** The threads of one page of `reviewThreads`. */
export const threadsFrom = (page: unknown): Thread[] => records(record(page).nodes).map(node => ({
  commentIds: records(record(node.comments).nodes).flatMap(comment => [textOf(comment.id), typeof comment.databaseId === 'number' ? String(comment.databaseId) : ''].filter(id => hasText(id))),
  id: textOf(node.id),
}))

const GH = process.env.GH ?? 'gh'

/** What `gh` prints for `args`, and its exit code. */
const run = async (args: readonly string[]): Promise<{ code: number, out: string }> => {
  const call = Bun.spawn([GH, ...args], { stderr: 'inherit', stdout: 'pipe' })
  const out = await new Response(call.stdout).text()
  return { code: await call.exited, out }
}

/** What is at `keys` inside an answer; an empty object where something on the way is missing. */
const at = (value: unknown, ...keys: string[]): Json => keys.reduce((inside: Json, key) => record(inside[key]), record(value))

type Variables = Readonly<Record<string, number | string | null>>

/**
 * A GraphQL call's `gh` arguments. `-f` passes a string as it is; `-F` would read a value starting
 * with `@` as a file, so only numbers and null (`-F` turns `null` into JSON's null) take it.
 */
const graphqlArgs = (query: string, variables: Variables): string[] => ['api', 'graphql', '-i', '-f', `query=${query}`,
  ...Object.entries(variables).flatMap(([name, value]) => [typeof value === 'string' ? '-f' : '-F', `${name}=${value ?? 'null'}`])]

/** Why GitHub refused a call, or null when it answered. */
const refusal = (answer: Answer): Error | null => {
  const errors = records(record(answer.body).errors)
  if (answer.status === 200 && errors.length === 0) {
    return null
  }
  const why = errors.map(error => textOf(error.message)).join('; ') || (isRecord(answer.body) ? textOf(answer.body.message) : textOf(answer.body))
  return new Error(`GitHub refused the call (HTTP ${answer.status}): ${why}`)
}

/** A GraphQL call's `data`, waiting once and trying again if GitHub refused it for a rate limit. */
const graphql = async (query: string, variables: Variables, retried = false): Promise<Json> => {
  const answer = answerFrom((await run(graphqlArgs(query, variables))).out)
  const wait = rateLimitWait(answer, Math.floor(Temporal.Now.instant().epochMilliseconds / 1000))
  if (wait !== null && !retried) {
    process.stderr.write(`Rate limited; trying once more in ${Math.ceil(wait / 1000)} s\n`)
    await Bun.sleep(wait)
    return graphql(query, variables, true)
  }
  const error = refusal(answer)
  if (error) {
    throw error
  }
  return at(answer.body, 'data')
}

const THREADS_QUERY = `query($owner:String!,$name:String!,$pr:Int!,$after:String){repository(owner:$owner,name:$name){pullRequest(number:$pr){
  reviewThreads(first:100,after:$after){nodes{id comments(first:100){nodes{id databaseId}}} pageInfo{hasNextPage endCursor}}}}}`

/** Every review thread of the PR, a page of a hundred at a time, each with its first hundred comments (a longer thread is unheard of). */
const threadsOf = async (repo: string, pr: number, after: string | null = null): Promise<Thread[]> => {
  const [owner = '', name = ''] = repo.split('/')
  const page = at(await graphql(THREADS_QUERY, { after, name, owner, pr }), 'repository', 'pullRequest', 'reviewThreads')
  const info = at(page, 'pageInfo')
  const rest = info.hasNextPage === true ? await threadsOf(repo, pr, textOf(info.endCursor)) : []
  return [...threadsFrom(page), ...rest]
}

const REPLY_MUTATION = 'mutation($thread:ID!,$body:String!){addPullRequestReviewThreadReply(input:{pullRequestReviewThreadId:$thread,body:$body}){comment{url}}}'

/** REPO, else the repository of the current folder; exits when there is none. */
const repoOf = async (): Promise<string> => {
  if (hasText(process.env.REPO)) {
    return process.env.REPO
  }
  const { code, out } = await run(['repo', 'view', '--json', 'nameWithOwner', '-q', '.nameWithOwner'])
  if (code !== 0 || !hasText(out.trim())) {
    process.stderr.write(`Which repository? Run this inside a GitHub repository's folder with ${GH} logged in, or set REPO=owner/name.\n`)
    process.exit(2)
  }
  return out.trim()
}

/** The command's arguments; exits with the usage when they don't fit. */
const argsOf = async (): Promise<{ body: string, pr: number, target: string }> => {
  const [prText = '', target = '', bodyArg = ''] = Bun.argv.slice(2)
  const pr = Number(prText)
  const body = bodyArg === '-' ? await Bun.stdin.text() : bodyArg
  if (!Number.isInteger(pr) || pr < 1 || !hasText(target) || !hasText(body)) {
    process.stderr.write('Usage: reply-review-thread <pr> <comment-id|PRRT_id> <body> (a body of - is read from stdin)\n')
    process.exit(64)
  }
  return { body, pr, target }
}

const main = async (): Promise<void> => {
  const { body, pr, target } = await argsOf()
  const repo = await repoOf()
  const thread = threadIdOf(target, target.startsWith('PRRT_') ? [] : await threadsOf(repo, pr))
  if (thread === null) {
    process.stderr.write(`No review thread on ${repo}#${pr} holds comment ${target}\n`)
    process.exit(1)
  }
  const reply = await graphql(REPLY_MUTATION, { body, thread })
  process.stdout.write(`${textOf(at(reply, 'addPullRequestReviewThreadReply', 'comment').url)}\n`)
}

if (import.meta.main) {
  await main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exit(1)
  })
}
