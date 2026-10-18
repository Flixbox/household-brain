import { describe, expect, it } from 'bun:test'
import { answer, tools } from './protocol'

const calls: string[][] = []
const all = tools({
  block: async (...texts) => {
    calls.push(['block', ...texts])
    return texts[1] === 'cycle' ? Promise.reject(new Error('refused: would close a cycle')) : 'now blocked'
  },
  links: async issue => `${issue} is blocked by nothing`,
  unblock: async () => 'no longer blocked',
})

describe('the MCP answers (#256)', () => {
  it('starts with the version the client asks for, and lists the three tools', async () => {
    expect(await answer({ id: 1, jsonrpc: '2.0', method: 'initialize', params: { protocolVersion: '2025-06-18' } }, all))
      .toMatchObject({ id: 1, result: { capabilities: { tools: {} }, protocolVersion: '2025-06-18', serverInfo: { name: 'issue-links' } } })
    expect(await answer({ id: 2, jsonrpc: '2.0', method: 'tools/list' }, all)).toMatchObject({
      result: { tools: [{ inputSchema: { required: ['issue', 'blocked_by'] }, name: 'block_issue' }, { name: 'unblock_issue' }, { name: 'issue_links' }] },
    })
  })

  it('runs a tool with its arguments in order, and gives a refusal back as its error', async () => {
    expect(await answer({ id: 3, jsonrpc: '2.0', method: 'tools/call', params: { arguments: { blocked_by: '#2', issue: '#1' }, name: 'block_issue' } }, all))
      .toEqual({ id: 3, jsonrpc: '2.0', result: { content: [{ text: 'now blocked', type: 'text' }] } })
    expect(calls).toContainEqual(['block', '#1', '#2'])
    expect(await answer({ id: 4, jsonrpc: '2.0', method: 'tools/call', params: { arguments: { blocked_by: 'cycle', issue: '#1' }, name: 'block_issue' } }, all))
      .toMatchObject({ result: { content: [{ text: 'refused: would close a cycle' }], isError: true } })
  })

  it('answers no notification, and an unknown method with an error', async () => {
    expect(await answer({ jsonrpc: '2.0', method: 'notifications/initialized' }, all)).toBeNull()
    expect(await answer({ id: 5, jsonrpc: '2.0', method: 'resources/list' }, all)).toMatchObject({ error: { code: -32_601 }, id: 5 })
  })
})
