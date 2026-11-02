/** Connect to the existing local daemon only. No separate server, login, or credentials. */
import type { CodexRequest } from './codex-notify'
import { isRecord } from './read'

interface Waiting { reject: (error: Error) => void, resolve: (value: unknown) => void }
interface Client { nextId: number, socket: WebSocket, waiting: Map<number, Waiting> }

const acceptReply = (message: Record<string, unknown>, waiting: Map<number, Waiting>): void => {
  const { id } = message
  if (typeof id !== 'number') { return }
  const pending = waiting.get(id)
  if (!pending) { return }
  waiting.delete(id)
  if (Object.hasOwn(message, 'error')) {
    pending.reject(new Error('Codex refused watcher delivery'))
  } else { pending.resolve(message.result) }
}

const received = (text: unknown, client: Client): void => {
  if (typeof text !== 'string') { return }
  try {
    const message: unknown = JSON.parse(text)
    if (isRecord(message)) { acceptReply(message, client.waiting) }
  } catch { client.socket.close() }
}

const failed = (client: Client): void => {
  for (const pending of client.waiting.values()) {
    pending.reject(new Error('Codex watcher connection closed or timed out'))
  }
  client.waiting.clear()
}

const connected = async (client: Client): Promise<void> => new Promise((resolve, reject) => {
  client.socket.addEventListener('open', () => { resolve() }, { once: true })
  client.socket.addEventListener('close', () => { reject(new Error('Codex daemon connection closed')); failed(client) })
  client.socket.addEventListener('error', () => { reject(new Error('Codex daemon unavailable')); failed(client) })
  client.socket.addEventListener('message', message => { received(message.data, client) })
})

const requestFrom = (client: Client): CodexRequest => async (method, params) => {
  client.nextId += 1
  const id = client.nextId
  const response = new Promise<unknown>((resolve, reject) => { client.waiting.set(id, { reject, resolve }) })
  client.socket.send(JSON.stringify({ id, method, params }))
  return response
}

const initialized = async (client: Client, request: CodexRequest): Promise<void> => {
  await connected(client)
  await request('initialize', { clientInfo: { name: 'project-watcher', version: '1.0' } })
  client.socket.send(JSON.stringify({ method: 'initialized' }))
}

/** Bun's native ws+unix transport uses the daemon's protected local control socket. */
export const withCodexSocket = async (work: (request: CodexRequest) => Promise<void>): Promise<void> => {
  const home = process.env.CODEX_HOME ?? `${process.env.HOME ?? '.'}/.codex`
  const client: Client = { nextId: 0, socket: new WebSocket(`ws+unix://${home}/app-server-control/app-server-control.sock:/`), waiting: new Map() }
  const timeout = setTimeout(() => { failed(client); client.socket.close() }, 15_000)
  const request = requestFrom(client)
  try {
    await initialized(client, request)
    await work(request)
  } finally {
    clearTimeout(timeout)
    client.socket.close()
  }
}
