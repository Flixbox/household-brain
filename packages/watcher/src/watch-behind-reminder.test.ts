/** How often the reminders for a branch that can't merge come (#508), over separate watcher processes sharing one state folder. */
import { afterEach, expect, test } from 'bun:test'
import { cleanUp, run, setUp } from './watch-writer-fixture'

afterEach(cleanUp)

/** One look on `main` that found an event, unrelated to the branches: the reminders close it. */
const lookAt = (main: string) => `
  import { flush, queue } from '${import.meta.dir}/watch-output'
  import { writeLines } from '${import.meta.dir}/watch-state'
  await writeLines('main', ['${main}'])
  queue(['SOMETHING_ELSE'])
  await flush()`

const openPr = (number: number, mergeStateStatus: string) => ({ autoMergeRequest: null, headRefOid: `head${number}`, isDraft: false, labels: [], mergeStateStatus, number, statusCheckRollup: [], title: `PR ${number}` })
const OPEN_PRS = JSON.stringify([openPr(7, 'BEHIND'), openPr(8, 'DIRTY'), openPr(9, 'BEHIND')])
const QUEUE = JSON.stringify({ data: { repository: { mergeQueue: { entries: { nodes: [{ enqueuedAt: '2026-01-01T00:00:00Z', position: 1, pullRequest: { number: 9 } }] } } } } })

/** Three open PRs: 7 only behind main, 8 in conflict, 9 behind main and in the merge queue. */
const ANSWERS = String.raw`pr\ list*) echo '${OPEN_PRS}'; exit 0 ;;
*mergeQueue{id}*) echo queue-id; exit 0 ;;
*mergeQueue{entries*) echo '${QUEUE}'; exit 0 ;;`

const remindersOf = (output: string, pr: number) => output.split('\n').filter(line => line.startsWith(`REMINDER: PR #${pr} `)).length

test('a branch only behind main is reminded of once per main head; a queued or conflicting one on every look (#508)', async () => {
  const { gh, home } = await setUp(ANSWERS)
  const env = { AGENT_USAGE_PROVIDER: 'claude', GH_SHARE_SECONDS: '0' }
  const looks = [
    await run({ env, gh, home, script: lookAt('main1') }),
    await run({ env, gh, home, script: lookAt('main1') }),
    await run({ env, gh, home, script: lookAt('main2') }),
  ]
  expect({
    behind: looks.map(output => remindersOf(output, 7)),
    conflicting: looks.map(output => remindersOf(output, 8)),
    queued: looks.map(output => remindersOf(output, 9)),
  }).toEqual({ behind: [1, 0, 1], conflicting: [1, 1, 1], queued: [1, 1, 1] })
}, 30_000)
