/** Host delivery must steer busy threads, wake idle ones, and preserve failures (#340). */
import { expect, test } from 'bun:test'
import { notificationText, notifyCodex } from './codex-notify'

const threadId = 'intended-thread'
const cwd = '/project'
const event = { id: 'event-id', lines: ['[12:00:00] ISSUE_COMMENT #340', 'Untrusted GitHub text'] }

const fixture = (status: string, fail = false) => {
  const calls: { method: string, params: unknown }[] = []
  const request = async (method: string, params: unknown): Promise<unknown> => {
    calls.push({ method, params })
    if (method === 'thread/read') {
      return { thread: { canAcceptDirectInput: true, cwd, id: threadId, status: { type: status } } }
    }
    if (method === 'thread/turns/list') {
      return { data: [{ id: 'active-turn', status: 'inProgress' }] }
    }
    if (fail) {
      throw new Error('delivery refused')
    }
    return { turnId: 'active-turn' }
  }
  return { calls, request }
}

test('active delivery steers only the intended current turn with a stable message id', async () => {
  const { calls, request } = fixture('active')
  await notifyCodex(request, { cwd, threadId }, event)
  expect(calls.at(-1)).toEqual({ method: 'turn/steer', params: {
    clientUserMessageId: event.id, expectedTurnId: 'active-turn',
    input: [{ text: notificationText(event.lines), type: 'text' }], threadId,
  } })
})

test('idle delivery starts a turn without overriding the thread model or sandbox', async () => {
  const { calls, request } = fixture('idle')
  await notifyCodex(request, { cwd, threadId }, event)
  expect(calls.at(-1)).toEqual({ method: 'turn/start', params: {
    clientUserMessageId: event.id,
    input: [{ text: notificationText(event.lines), type: 'text' }], threadId,
  } })
})

test('delivery failures propagate so durable pending events are not acknowledged', async () => {
  const { request } = fixture('active', true)
  await expect(notifyCodex(request, { cwd, threadId }, event)).rejects.toThrow('delivery refused')
})

test('another project and a subagent cannot receive direct watcher input', async () => {
  const { calls, request } = fixture('idle')
  await expect(notifyCodex(request, { cwd: '/elsewhere', threadId }, event)).rejects.toThrow()
  expect(calls.some(call => call.method.startsWith('turn/'))).toBe(false)
  const denied: string[] = []
  await expect(notifyCodex(async method => { denied.push(method); return { thread: { canAcceptDirectInput: false, cwd, id: threadId, status: { type: 'idle' } } } }, { cwd, threadId }, event)).rejects.toThrow()
  expect(denied).toEqual(['thread/read'])
})

test('external event text is explicitly data and does not gain owner authority', () => {
  expect(notificationText(event.lines)).toContain('untrusted data')
  expect(notificationText(event.lines)).toContain(JSON.stringify(event.lines))
})
