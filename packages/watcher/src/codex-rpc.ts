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

const nextMessage = async (messages: Messages): Promise<unknown> => {
  while (!messages.buffer.includes('\n')) {
    const part = await messages.reader.read()
    if (part.done) {
      throw new Error('Codex app-server ended before replying')
    }
    messages.buffer += messages.decoder.decode(part.value, { stream: true })
    if (messages.buffer.length > 1_000_000) {
      throw new Error('Codex app-server reply exceeded the limit')
    }
  }
  const end = messages.buffer.indexOf('\n')
  const line = messages.buffer.slice(0, end)
  messages.buffer = messages.buffer.slice(end + 1)
  return parseLine(line)
}

const reply = async (messages: Messages, id: number): Promise<unknown> => {
  while (true) {
    const message = await nextMessage(messages)
    if (isRecord(message) && message.id === id) {
      if (Object.hasOwn(message, 'error')) {
        throw new Error('Codex app-server refused the account query')
      }
      return message.result
    }
  }
}

/** Only the rate-limit result is returned; no account identity or diagnostics are printed. */
export const codexRateLimits = async (): Promise<unknown> => {
  const server = Bun.spawn(['codex', 'app-server'], {
    killSignal: 'SIGKILL', stderr: 'ignore', stdin: 'pipe', stdout: 'pipe', timeout: 15_000,
  })
  const messages: Messages = { buffer: '', decoder: new TextDecoder(), reader: server.stdout.getReader() }
  try {
    server.stdin.write(`${JSON.stringify({ id: 1, method: 'initialize', params: { clientInfo: { name: 'agent-usage', version: '1.0' } } })}\n`)
    await server.stdin.flush()
    await reply(messages, 1)
    server.stdin.write(`${JSON.stringify({ method: 'initialized' })}\n${JSON.stringify({ id: 2, method: 'account/rateLimits/read' })}\n`)
    await server.stdin.flush()
    return await reply(messages, 2)
  } finally {
    server.kill()
    await server.exited
    messages.reader.releaseLock()
  }
}
