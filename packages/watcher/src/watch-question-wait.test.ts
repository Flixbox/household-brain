import { afterEach, describe, expect, it } from 'bun:test'
import { MERGED_STATE, QUESTION, cleanUp, lookAtWriter, run, setUp } from './watch-writer-fixture'

const MINUTE = 60_000
/** A subscribed watcher's look at the merged PR; prints whether its subscription may go on to end. `now`: the look's time, in epoch milliseconds. */
const terminalLook = (state = MERGED_STATE, now = 'Temporal.Now.instant().epochMilliseconds') => `
  import { flush } from '${import.meta.dir}/watch-output'
  import { preparePr } from '${import.meta.dir}/watch-queue'
  const ends = await preparePr(7, ${state}, ${now})
  console.log(ends ? 'LOOK_ENDS' : 'LOOK_HOLDS')
  await flush()`

afterEach(cleanUp)

describe('a subscribed watcher waits for the writer\'s outcome on a finished PR (#440)', () => {
  it('a subscribed watcher holds a merged PR that still carries the label while a writer runs (#440)', async () => {
    const { gh, home } = await setUp()
    await run({ gh, home, script: lookAtWriter() })
    expect(await run({ gh, home, scoped: true, script: terminalLook() })).toContain('LOOK_HOLDS')
  }, 30_000)

  it('a wait outlasts the label: the writer takes it off before it leaves its outcome', async () => {
    const { gh, home } = await setUp()
    await run({ gh, home, script: lookAtWriter() })
    await run({ gh, home, scoped: true, script: terminalLook() })
    const unlabelled = MERGED_STATE.replace("labels: ['question']", 'labels: []')
    expect(await run({ gh, home, scoped: true, script: terminalLook(unlabelled) })).toContain('LOOK_HOLDS')
  }, 30_000)

  it('a wait belongs to its head: a new head waits afresh', async () => {
    const { gh, home } = await setUp()
    await run({ gh, home, script: lookAtWriter() })
    const tenMinutesAgo = String(Temporal.Now.instant().epochMilliseconds - 10 * MINUTE)
    await run({ gh, home, scoped: true, script: terminalLook(MERGED_STATE, tenMinutesAgo) })
    const newHead = MERGED_STATE.replace("head: 'abc1234'", "head: 'def5678'")
    expect(await run({ gh, home, scoped: true, script: terminalLook(newHead) })).toContain('LOOK_HOLDS')
  }, 30_000)

  it('it lets go once the outcome has been relayed', async () => {
    const { gh, home } = await setUp()
    await run({ gh, home, script: lookAtWriter() })
    await run({ gh, home, scoped: true, script: terminalLook() })
    await run({ gh, home, script: QUESTION })
    const look = await run({ gh, home, scoped: true, script: terminalLook() })
    expect(look).toContain('PR #7: QUESTION_CLEAR_FAILED')
    expect(look).toContain('LOOK_ENDS')
  }, 30_000)

  it('it waits a bounded time: past the bound the look ends without an outcome', async () => {
    const { gh, home } = await setUp()
    await run({ gh, home, script: lookAtWriter() })
    const tenMinutesAgo = String(Temporal.Now.instant().epochMilliseconds - 10 * MINUTE)
    expect(await run({ gh, home, scoped: true, script: terminalLook(MERGED_STATE, tenMinutesAgo) })).toContain('LOOK_HOLDS')
    expect(await run({ gh, home, scoped: true, script: terminalLook() })).toContain('LOOK_ENDS')
  }, 30_000)

  it('it does not wait when no writer is running, or the label is off', async () => {
    const { gh, home } = await setUp()
    expect(await run({ gh, home, scoped: true, script: terminalLook() })).toContain('LOOK_ENDS')
    await run({ gh, home, script: lookAtWriter() })
    const unlabelled = MERGED_STATE.replace("labels: ['question']", 'labels: []')
    expect(await run({ gh, home, scoped: true, script: terminalLook(unlabelled) })).toContain('LOOK_ENDS')
  }, 30_000)
})
