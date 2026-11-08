/** What a PR's CI comes to, for the open-PR list and its reminders (watch-events.ts), and NOT_QUEUED (watch-queue-events.ts). */

interface RunResult {
  attempt: number
  outcome: string
  pr: string
  /** 0 on a line recorded before the keys held the run id (#486), older than any run. */
  run: number
  sha: string
}

/** A CI result's report line: each run and attempt has its own (#401, #486), so a rerun or another run on the sha reports too. */
export const ciResultKey = (outcome: 'passed' | 'failed', { pr, sha }: { pr: number, sha: string }, { attempt, id }: { attempt: number, id: number }): string =>
  `pr-${pr} ci-${outcome} ${sha} ${id} ${attempt}`

const RESULT_LINE = /^pr-(?<pr>\d+) ci-(?<outcome>passed|failed) (?<sha>\S+)(?<numbers>(?: \d+)*)$/u

/** A result line, in either form: `<run> <attempt>`, or from before the run id just `[<attempt>]`. */
const resultOf = (line: string): RunResult[] => {
  const { numbers = '', outcome = '', pr = '', sha = '' } = RESULT_LINE.exec(line)?.groups ?? {}
  if (pr === '') {
    return []
  }
  const [first = 1, second = 0] = numbers.trim().split(' ').filter(Boolean).map(Number)
  return numbers.trim().includes(' ') ? [{ attempt: second, outcome, pr, run: first, sha }] : [{ attempt: first, outcome, pr, run: 0, sha }]
}

const isOlder = (result: RunResult, next: RunResult): boolean =>
  result.run === next.run ? result.attempt <= next.attempt : result.run < next.run

/**
 * Whether `head`'s latest reported result passed (#419): by run, then attempt, as a run's attempts
 * start again at 1 (#486). Among lines from before the run id, the later one wins a tie (#430).
 */
export const reportedPassed = (reported: readonly string[], pr: number, head: string): boolean => {
  const results = reported.flatMap(line => resultOf(line)).filter(result => result.pr === String(pr) && result.sha === head)
  const latest = results.reduce<RunResult | null>((found, result) => (!found || isOlder(found, result) ? result : found), null)
  return latest?.outcome === 'passed'
}

/** What the line for this result said before the run id. */
const oldKey = ({ attempt, outcome, pr, sha }: RunResult): string => {
  const key = `pr-${pr} ci-${outcome} ${sha}`
  return outcome === 'passed' && attempt === 1 ? key : `${key} ${attempt}`
}

/**
 * The reported lines with this result's old line taken over by `key` (#486), or null when there is
 * none. So a watcher that restarts on this code doesn't report again every result it recorded in the
 * old form. The sha's other old lines go too: they are older runs, and left behind one would pass for
 * a later run's result and swallow its report.
 */
export const adoptOldCiKey = (lines: readonly string[], key: string): readonly string[] | null => {
  const [result] = resultOf(key)
  if (!result || result.run === 0 || !lines.includes(oldKey(result))) {
    return null
  }
  const isOldOfSha = (line: string) => resultOf(line).some(old => old.run === 0 && old.pr === result.pr && old.sha === result.sha)
  return lines.flatMap(line => {
    if (line === oldKey(result)) {
      return [key]
    }
    return isOldOfSha(line) ? [] : [line]
  })
}

interface HeadRun {
  conclusion: string
  status: string
}

const FAILED = new Set(['FAILURE', 'ERROR', 'TIMED_OUT', 'CANCELLED', 'STARTUP_FAILURE', 'ACTION_REQUIRED'])
const DONE = new Set(['SUCCESS', 'SKIPPED', 'NEUTRAL'])

const NO_RESULT = new Set(['neutral', 'skipped'])

/** Whether GitHub has finished every check without a failing result. */
export const checksPassed = (checks: string[]): boolean => checks.every(check => DONE.has(check))

/** What WORKFLOW's run on the head says on its own: none, or one that ran nothing, reports no result. */
const headRunState = (run: HeadRun | null) => {
  if (!run) {
    return 'not reported'
  }
  if (run.status !== 'completed') {
    return 'running'
  }
  if (run.conclusion === 'success') {
    return 'green'
  }
  return NO_RESULT.has(run.conclusion) ? 'not reported' : 'failed'
}

/**
 * Failed as soon as any check did. Green only once WORKFLOW's run on the head passed and nothing else
 * still runs (#342): the rollup holds other apps' checks too, so on its own a lone skipped or passed
 * one, or no check at all, read as green before CI had reported.
 */
export const ciState = ({ checks, headRun }: { checks: string[], headRun: HeadRun | null }) => {
  if (checks.some(check => FAILED.has(check))) {
    return 'failed'
  }
  const state = headRunState(headRun)
  return state === 'green' && !checksPassed(checks) ? 'running' : state
}
