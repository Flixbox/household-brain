/**
 * The MCP server's answers (#256), apart from its input and output so they are tested. MCP over stdio
 * is JSON-RPC 2.0, one message per line; this plugin is a folder copied on its own, without installed
 * packages, so it can't use the MCP SDK and answers the four methods a tool server needs itself.
 */
import { isRecord, textOf } from './read'

type Command = (...texts: string[]) => Promise<string>

const ISSUE = 'An issue: 12, #12 (in the repository Claude Code runs in, or REPO) or owner/repo#12.'

/** The tools, each with the command it runs and the arguments it passes, in order. */
export const tools = (commands: Record<'audit' | 'block' | 'links' | 'unblock', Command>) => [
  {
    arguments: ['issue', 'blocked_by'],
    command: commands.block,
    description: 'Mark an issue as blocked by another, in any repository gh can reach. Refused, with the cycle, when the other issue is already blocked by it, directly or through others.',
    name: 'block_issue',
  },
  { arguments: ['issue', 'blocked_by'], command: commands.unblock, description: 'Remove the link that marks an issue as blocked by another.', name: 'unblock_issue' },
  { arguments: ['issue'], command: commands.links, description: 'What an issue is blocked by, and what it blocks.', name: 'issue_links' },
  {
    arguments: ['repo'],
    command: commands.audit,
    description: "Find every cycle in the blocked-by links between a repository's open issues, links set past block_issue included. Each cycle comes back as an error, as a path #a → #b → … → #a.",
    name: 'audit_links',
  },
]

type Tool = ReturnType<typeof tools>[number]

const ARGUMENTS: Record<string, string> = {
  blocked_by: `The blocking issue. ${ISSUE}`,
  issue: ISSUE,
  repo: 'The repository, owner/repo; by default the one Claude Code runs in, or REPO.',
}

/** Every argument is required but `repo`, which has a default. */
const schema = (tool: Tool) => ({
  properties: Object.fromEntries(tool.arguments.map(name => [name, { description: ARGUMENTS[name] ?? '', type: 'string' }])),
  required: tool.arguments.filter(name => name !== 'repo'),
  type: 'object',
})

const result = (id: unknown, value: unknown) => ({ id, jsonrpc: '2.0', result: value })
const failure = (id: unknown, code: number, message: string) => ({ error: { code, message }, id, jsonrpc: '2.0' })

/** The protocol versions these answers follow, newest first: the client's when it is one of them. */
const VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05']

/** A tool call's answer; a refusal or failure comes back as the tool's error text, not a protocol error. */
const call = async (all: Tool[], params: Record<string, unknown>) => {
  const tool = all.find(known => known.name === params.name)
  const given = isRecord(params.arguments) ? params.arguments : {}
  if (!tool) {
    return { content: [{ text: `no tool named ${textOf(params.name)}`, type: 'text' }], isError: true }
  }
  return tool.command(...tool.arguments.map(name => textOf(given[name]))).then(
    text => ({ content: [{ text, type: 'text' }] }),
    (error: unknown) => ({ content: [{ text: error instanceof Error ? error.message : 'failed', type: 'text' }], isError: true }),
  )
}

interface Request {
  id: unknown
  method: string
  params: Record<string, unknown>
}

/** The answer to a request by its method. */
const byMethod = async ({ id, method, params }: Request, all: Tool[]) => {
  switch (method) {
    case 'initialize': {
      const asked = textOf(params.protocolVersion)
      return result(id, { capabilities: { tools: {} }, protocolVersion: VERSIONS.includes(asked) ? asked : VERSIONS[0], serverInfo: { name: 'issue-links', version: '1.0.0' } })
    }
    case 'ping': {
      return result(id, {})
    }
    case 'tools/list': {
      return result(id, { tools: all.map(tool => ({ description: tool.description, inputSchema: schema(tool), name: tool.name })) })
    }
    case 'tools/call': {
      return result(id, await call(all, params))
    }
    default: {
      return failure(id, -32_601, `no method ${method}`)
    }
  }
}

const validId = (id: unknown) => typeof id === 'string' || typeof id === 'number' || id === null

/** The answer to one message; null for a notification, which gets none. */
export const answer = async (message: unknown, all: Tool[]): Promise<Record<string, unknown> | null> => {
  const fields = isRecord(message) ? message : {}
  const { id, method, params } = fields
  const request = fields.jsonrpc === '2.0' && typeof method === 'string'
  if (request && !('id' in fields)) {
    return null
  }
  if (!request || !validId(id)) {
    // Not a request to answer by its id: the answer has none (JSON-RPC 2.0).
    return failure(validId(id) ? id : null, -32_600, 'not a JSON-RPC 2.0 request')
  }
  if ('params' in fields && !isRecord(params)) {
    return failure(id, -32_602, 'params must be an object')
  }
  return byMethod({ id, method, params: isRecord(params) ? params : {} }, all)
}
