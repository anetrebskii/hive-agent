/**
 * Minimal MCP Streamable HTTP client — JSON-RPC 2.0 over HTTP POST, zero deps.
 *
 * Implements just what an agent needs against a remote MCP server:
 * initialize handshake, tools/list, tools/call. Server-initiated streams and
 * resumability are out of scope (we do synchronous request/response only).
 *
 * A response may come back as `application/json` (one message) or
 * `text/event-stream` (SSE-framed); both are handled.
 */

const PROTOCOL_VERSION = '2025-06-18'

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>

interface JsonRpcResponse {
  jsonrpc: '2.0'
  id?: number
  result?: unknown
  error?: { code: number; message: string; data?: unknown }
}

export interface McpToolDef {
  name: string
  description?: string
  inputSchema: unknown
}

export interface McpCallResult {
  content: unknown
  isError?: boolean
}

/** Parse the `data:` payloads out of an SSE body into JSON-RPC messages. */
export function parseSseMessages(raw: string): JsonRpcResponse[] {
  const out: JsonRpcResponse[] = []
  for (const chunk of raw.split(/\r?\n\r?\n/)) {
    const dataLines = chunk
      .split(/\r?\n/)
      .filter(line => line.startsWith('data:'))
      .map(line => line.slice(5).replace(/^ /, ''))
    if (dataLines.length === 0) continue
    try {
      out.push(JSON.parse(dataLines.join('\n')) as JsonRpcResponse)
    } catch {
      // Ignore non-JSON events (comments, pings).
    }
  }
  return out
}

async function readMessage(res: Response, id: number): Promise<JsonRpcResponse> {
  const contentType = res.headers.get('content-type') ?? ''
  const text = await res.text()
  if (contentType.includes('text/event-stream')) {
    const messages = parseSseMessages(text)
    const match =
      messages.find(m => m.id === id) ??
      messages.find(m => m.result !== undefined || m.error !== undefined)
    if (!match) throw new Error(`No JSON-RPC response in SSE stream for id ${id}`)
    return match
  }
  if (!text.trim()) throw new Error('Empty response from MCP server')
  return JSON.parse(text) as JsonRpcResponse
}

export class McpHttpClient {
  private url: string
  private headers: Record<string, string>
  private fetchImpl: FetchLike
  private sessionId?: string
  private protocolVersion = PROTOCOL_VERSION
  private nextId = 1
  private initialized = false

  constructor(url: string, headers: Record<string, string> = {}, fetchImpl?: FetchLike) {
    this.url = url
    this.headers = headers
    const globalFetch = (globalThis as { fetch?: FetchLike }).fetch
    this.fetchImpl = fetchImpl ?? globalFetch!
    if (!this.fetchImpl) {
      throw new Error('global fetch is unavailable; pass a fetch implementation to McpHttpClient')
    }
  }

  async initialize(clientInfo: { name: string; version: string }): Promise<{ instructions?: string }> {
    const result = (await this.request('initialize', {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo,
    }, true)) as { protocolVersion?: string; instructions?: string } | undefined
    if (result?.protocolVersion) this.protocolVersion = result.protocolVersion
    this.initialized = true
    await this.notify('notifications/initialized')
    return { instructions: result?.instructions }
  }

  async listTools(): Promise<McpToolDef[]> {
    const result = (await this.request('tools/list', {})) as { tools?: McpToolDef[] } | undefined
    return result?.tools ?? []
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<McpCallResult> {
    return (await this.request('tools/call', { name, arguments: args })) as McpCallResult
  }

  async close(): Promise<void> {
    if (this.sessionId) {
      try {
        await this.fetchImpl(this.url, { method: 'DELETE', headers: this.buildHeaders() })
      } catch {
        // Best-effort session teardown.
      }
      this.sessionId = undefined
    }
    this.initialized = false
  }

  private buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      ...this.headers,
    }
    if (this.sessionId) headers['mcp-session-id'] = this.sessionId
    if (this.initialized) headers['mcp-protocol-version'] = this.protocolVersion
    return headers
  }

  private async request(method: string, params: unknown, captureSession = false): Promise<unknown> {
    const id = this.nextId++
    const res = await this.fetchImpl(this.url, {
      method: 'POST',
      headers: this.buildHeaders(),
      body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
    })
    if (captureSession) {
      const sid = res.headers.get('mcp-session-id')
      if (sid) this.sessionId = sid
    }
    if (!res.ok) {
      throw new Error(`MCP HTTP ${res.status} for ${method}: ${await safeText(res)}`)
    }
    const message = await readMessage(res, id)
    if (message.error) {
      throw new Error(`MCP error ${message.error.code} for ${method}: ${message.error.message}`)
    }
    return message.result
  }

  private async notify(method: string, params?: unknown): Promise<void> {
    const res = await this.fetchImpl(this.url, {
      method: 'POST',
      headers: this.buildHeaders(),
      body: JSON.stringify({ jsonrpc: '2.0', method, params }),
    })
    // Notifications return 202 with no useful body — drain and move on.
    const body = res.body as { cancel?: () => Promise<void> } | null
    if (body?.cancel) {
      try {
        await body.cancel()
      } catch {
        // ignore
      }
    }
  }
}

async function safeText(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 500)
  } catch {
    return '<no body>'
  }
}
