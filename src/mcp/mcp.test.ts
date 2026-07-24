import { describe, it, expect } from 'vitest'
import { McpConnection, sanitizeToolName, normalizeSchema, flattenContent } from './client.js'
import { parseSseMessages, type FetchLike } from './http-client.js'
import { McpManager } from './manager.js'
import type { ToolContext } from '../types.js'

const ctx: ToolContext = { remainingTokens: 1000 }

/** A fake Streamable HTTP MCP server backed by a tool map. */
function fakeServer(opts: {
  tools?: Array<{ name: string; description?: string; inputSchema?: unknown }>
  instructions?: string
  json?: boolean
  onCall?: (name: string, args: Record<string, unknown>) => { content: unknown; isError?: boolean }
} = {}): FetchLike {
  const tools = opts.tools ?? [
    { name: 'echo', description: 'Echo text', inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] } },
  ]
  return async (_url, init) => {
    const body = JSON.parse(init.body as string) as { id?: number; method: string; params?: any }
    if (body.method === 'notifications/initialized') {
      return new Response(null, { status: 202 })
    }
    let result: unknown
    if (body.method === 'initialize') {
      result = { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'fake', version: '1' }, instructions: opts.instructions }
    } else if (body.method === 'tools/list') {
      result = { tools }
    } else if (body.method === 'tools/call') {
      const { name, arguments: args } = body.params
      result = opts.onCall ? opts.onCall(name, args) : { content: [{ type: 'text', text: `echo: ${args.text}` }] }
    }
    const payload = JSON.stringify({ jsonrpc: '2.0', id: body.id, result })
    if (opts.json === false) {
      const sse = `event: message\ndata: ${payload}\n\n`
      return new Response(sse, { status: 200, headers: { 'content-type': 'text/event-stream', 'mcp-session-id': 'sess-1' } })
    }
    return new Response(payload, { status: 200, headers: { 'content-type': 'application/json', 'mcp-session-id': 'sess-1' } })
  }
}

describe('helpers', () => {
  it('sanitizeToolName strips invalid chars and caps length', () => {
    expect(sanitizeToolName('gcal__list.events')).toBe('gcal__list_events')
    expect(sanitizeToolName('a b/c')).toBe('a_b_c')
    expect(sanitizeToolName('x'.repeat(80)).length).toBe(64)
  })

  it('normalizeSchema passes object schemas through and defaults otherwise', () => {
    expect(normalizeSchema({ type: 'object', properties: { a: { type: 'string' } } })).toEqual({
      type: 'object',
      properties: { a: { type: 'string' } },
    })
    expect(normalizeSchema(undefined)).toEqual({ type: 'object', properties: {} })
    expect(normalizeSchema({ type: 'object' })).toEqual({ type: 'object', properties: {} })
  })

  it('flattenContent joins text, resources, images', () => {
    expect(flattenContent([{ type: 'text', text: 'hi' }, { type: 'text', text: 'bye' }])).toBe('hi\nbye')
    expect(flattenContent([{ type: 'resource', resource: { uri: 'file://x' } }])).toBe('[resource: file://x]')
    expect(flattenContent([{ type: 'image', mimeType: 'image/png' }])).toBe('[image image/png]')
    expect(flattenContent('nope')).toBe('')
  })

  it('parseSseMessages extracts JSON-RPC payloads', () => {
    const raw = 'event: message\ndata: {"jsonrpc":"2.0","id":1,"result":{"ok":true}}\n\n: ping\n\n'
    const msgs = parseSseMessages(raw)
    expect(msgs).toHaveLength(1)
    expect(msgs[0].result).toEqual({ ok: true })
  })
})

describe('McpConnection', () => {
  it('connects, discovers, and wraps tools (namespaced)', async () => {
    const conn = new McpConnection({ name: 'test', url: 'http://x', description: 'a test server' })
    await conn.connect(fakeServer({ instructions: 'Use echo to repeat text.' }))
    const tools = conn.getTools()
    expect(tools).toHaveLength(1)
    expect(tools[0].name).toBe('test__echo')
    expect(tools[0].description).toBe('Echo text')
    expect(tools[0].parameters.properties).toHaveProperty('text')

    const res = await tools[0].execute({ text: 'hi' }, ctx)
    expect(res.success).toBe(true)
    expect(res.data).toBe('echo: hi')

    const info = conn.info()
    expect(info.connected).toBe(true)
    expect(info.toolCount).toBe(1)
    expect(info.instructions).toBe('Use echo to repeat text.')
  })

  it('parses SSE-framed responses', async () => {
    const conn = new McpConnection({ name: 'test', url: 'http://x' })
    await conn.connect(fakeServer({ json: false }))
    const res = await conn.getTools()[0].execute({ text: 'yo' }, ctx)
    expect(res.success).toBe(true)
    expect(res.data).toBe('echo: yo')
  })

  it('surfaces tool errors as failed ToolResults', async () => {
    const conn = new McpConnection({ name: 'test', url: 'http://x' })
    await conn.connect(fakeServer({ onCall: () => ({ content: [{ type: 'text', text: 'boom' }], isError: true }) }))
    const res = await conn.getTools()[0].execute({ text: 'x' }, ctx)
    expect(res.success).toBe(false)
    expect(res.error).toBe('boom')
  })

  it('applies allowTools / denyTools filters', async () => {
    const server = fakeServer({
      tools: [
        { name: 'read', inputSchema: { type: 'object', properties: {} } },
        { name: 'write', inputSchema: { type: 'object', properties: {} } },
      ],
    })
    const allow = new McpConnection({ name: 's', url: 'http://x', allowTools: ['read'] })
    await allow.connect(server)
    expect(allow.getTools().map(t => t.name)).toEqual(['s__read'])

    const deny = new McpConnection({ name: 's', url: 'http://x', denyTools: ['write'] })
    await deny.connect(server)
    expect(deny.getTools().map(t => t.name)).toEqual(['s__read'])
  })

  it('getTools throws before connect', () => {
    const conn = new McpConnection({ name: 's', url: 'http://x' })
    expect(() => conn.getTools()).toThrow(/not connected/)
  })
})

describe('McpManager', () => {
  it('aggregates tools and builds a prompt section', async () => {
    const mgr = new McpManager([
      { name: 'hubspot', url: 'http://a', description: 'CRM' },
      { name: 'gcal', url: 'http://b', description: 'Calendar' },
    ])
    // Inject the fake transport by connecting each connection directly.
    // Manager.connect() uses the real fetch, so drive connections via a custom path:
    for (const c of (mgr as unknown as { connections: McpConnection[] }).connections) {
      await c.connect(fakeServer({ instructions: 'server notes here' }))
    }

    const tools = mgr.getTools()
    expect(tools.map(t => t.name).sort()).toEqual(['gcal__echo', 'hubspot__echo'])

    const section = mgr.getPromptSection()
    expect(section).toContain('## Connected MCP servers')
    expect(section).toContain('hubspot — CRM')
    expect(section).toContain('gcal — Calendar')
    expect(section).toContain('server notes here')

    const infos = mgr.getServerInfo()
    expect(infos).toHaveLength(2)
    expect(infos.every(i => i.connected)).toBe(true)
  })

  it('getPromptSection is empty when nothing is connected', () => {
    const mgr = new McpManager([{ name: 'x', url: 'http://a' }])
    expect(mgr.getPromptSection()).toBe('')
    expect(mgr.getTools()).toEqual([])
  })
})
