/** Read-only account query through Codex's authenticated app-server; credentials stay in Codex. */
import { isRecord } from './read'

interface Messages {
  buffer: string
  decoder: TextDecoder
  reader: ReadableStreamDefaultReader<Uint8Array>
}

const parseLine = (line: string): unknown => {
  try {
    return JSON.parse(line)
  } catch {
    return null
  }
}

const readChunk = async (messages: Messages): Promise<void> => {
  const part = await messages.reader.read()
  if (part.done) {
    throw new Error('Codex app-server ended before replying')
  }
  messages.buffer += messages.decoder.decode(part.value, { stream: true })
  if (messages.buffer.length > 1_000_000) {
    throw new Error('Codex app-server reply exceeded the limit')
  }
}

const nextMessage = async (messages: Messages): Promise<unknown> => {
  if (!messages.buffer.includes('\n')) {
    await readChunk(messages)
    return nextMessage(messages)
  }
  const end = messages.buffer.indexOf('\n')
  const line = messages.buffer.slice(0, end)
  messages.buffer = messages.buffer.slice(end + 1)
  return parseLine(line)
}

const reply = async (messages: Messages, id: number): Promise<unknown> => {
  const message = await nextMessage(messages)
  if (!isRecord(message) || message.id !== id) {
    return reply(messages, id)
  }
  if (Object.hasOwn(message, 'error')) {
    throw new Error('Codex app-server refused the account query')
  }
  return message.result
}

const send = async (input: Bun.FileSink, message: unknown): Promise<void> => {
  await input.write(`${JSON.stringify(message)}\n`)
  await input.flush()
}

const accountQuery = async (input: Bun.FileSink, messages: Messages): Promise<unknown> => {
  await send(input, { id: 1, method: 'initialize', params: { clientInfo: { name: 'agent-usage', version: '1.0' } } })
  await reply(messages, 1)
  await send(input, { method: 'initialized' })
  await send(input, { id: 2, method: 'account/rateLimits/read' })
  return reply(messages, 2)
}

/** Only the rate-limit result is returned; no account identity or diagnostics are printed. */
export const codexRateLimits = async (): Promise<unknown> => {
  const server = Bun.spawn(['codex', 'app-server'], {
    killSignal: 'SIGKILL', stderr: 'ignore', stdin: 'pipe', stdout: 'pipe', timeout: 15_000,
  })
  const messages: Messages = { buffer: '', decoder: new TextDecoder(), reader: server.stdout.getReader() }
  try {
    return await accountQuery(server.stdin, messages)
  } finally {
    server.kill()
    await server.exited
    messages.reader.releaseLock()
  }
}
