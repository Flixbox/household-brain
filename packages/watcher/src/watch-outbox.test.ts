/* oxlint-disable import/no-nodejs-modules -- temporary delivery files exercise restart recovery */
import { expect, test } from 'bun:test'
import { tmpdir } from 'node:os'
import { mkdtemp, rm } from 'node:fs/promises'
import { DeliveryOutbox, actionable } from './watch-outbox'

const lines = ['[12:00:00] ISSUE_COMMENT #340', 'external text']

test('heartbeats, usage and reminders cannot wake an idle model', () => {
  expect(actionable(['[12:00:00] IDLE: nothing happened'])).toBe(false)
  expect(actionable(['Usage (codex): session 12% used'])).toBe(false)
  expect(actionable(['REMINDER: PR #341'])).toBe(false)
  expect(actionable(lines)).toBe(true)
})

test('delivery failure survives restart, retries the same id, and acknowledges once', async () => {
  const dir = await mkdtemp(`${tmpdir()}/watcher-outbox-`)
  try {
    const file = `${dir}/pending.json`
    const first = new DeliveryOutbox(file)
    first.enqueue('comment-1', lines)
    expect(first.pending).toBe(true)
    first.enqueue('comment-1', lines)
    const attempted: string[] = []
    await expect(first.drain(async event => { attempted.push(event.id); throw new Error('offline') })).rejects.toThrow('offline')
    const restarted = new DeliveryOutbox(file)
    await restarted.drain(async event => { attempted.push(event.id) })
    expect(restarted.pending).toBe(false)
    expect(attempted).toHaveLength(2)
    expect(attempted[0]).toBe(attempted[1])
    restarted.enqueue('comment-1', lines)
    await restarted.drain(async () => { throw new Error('duplicate delivery') })
    restarted.enqueue('comment-2', lines)
    const distinct: string[] = []
    await restarted.drain(async entry => { distinct.push(entry.id) })
    expect(distinct).toHaveLength(1)
    expect(distinct[0]).not.toBe(attempted[0])
  } finally { await rm(dir, { recursive: true }) }
})
