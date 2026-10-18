/** The MCP server Claude Code starts for this plugin (#256): one JSON-RPC message per line on stdin, one answer per line on stdout. */
import { answer, tools } from './protocol'
import { commands } from './commands'

const all = tools(commands)

const handle = async (line: string): Promise<void> => {
  // Parsed inside the promise, so a line that isn't JSON gets an error answer too.
  const reply = await Promise.resolve().then(async () => answer(JSON.parse(line), all)).catch((error: unknown) => ({ error: { code: -32_700, message: error instanceof Error ? error.message : 'unreadable' }, id: null, jsonrpc: '2.0' }))
  if (reply) {
    process.stdout.write(`${JSON.stringify(reply)}\n`)
  }
}

// One message after another: Claude Code waits for each tool's answer anyway.
for await (const line of console) {
  if (line.trim() !== '') {
    await handle(line)
  }
}
