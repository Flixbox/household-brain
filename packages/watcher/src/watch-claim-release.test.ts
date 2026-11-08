import { afterEach, describe, expect, it } from 'bun:test'
import { cleanUp, run, setUp } from './watch-writer-fixture'

/**
 * A following watcher whose Codex outbox can't be written during one look and works again for the
 * next, with two pollers finding the same event in each look (#498).
 */
const twoLooks = (act: string) => `
  process.argv.push('--follow')
  const { checkWriter } = await import('${import.meta.dir}/watch-writer')
  const { report } = await import('${import.meta.dir}/watch-output')
  const { DIR } = await import('${import.meta.dir}/watch-state')
  const outbox = DIR + '/codex-delivery-' + Bun.hash('a-thread').toString(36) + '.json'
  const act = async () => ${act}
  await Bun.write(outbox, 'not json')
  await Promise.allSettled([act(), act()])
  await Bun.write(outbox, '[]')
  await Promise.all([act(), act()])
  process.exit(0)`

const printedTimes = async (act: string, line: string) => {
  const { gh, home } = await setUp()
  const output = await run({ env: { CODEX_WATCH_THREAD: 'a-thread' }, gh, home, scoped: true, script: twoLooks(act) })
  return output.split('\n').filter(printed => printed.includes(line)).length
}

afterEach(cleanUp)

describe('a claim whose print failed (#498)', () => {
  it('is released, so the next look reports the event, once', async () => {
    expect(await printedTimes("report({ key: 'a-news', lines: ['A_NEWS'] }, 7)", 'A_NEWS')).toBe(1)
  }, 30_000)

  it('is released for the missing writer too', async () => {
    expect(await printedTimes('checkWriter(0)', 'NO_WRITER')).toBe(1)
  }, 30_000)
})
