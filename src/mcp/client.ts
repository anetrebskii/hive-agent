/**
 * MCP connection — connects to a single MCP server over Streamable HTTP and
 * wraps its tools as native Tuplet tools.
 */

import type { Tool, ToolResult, JSONSchema } from '../types.js'
import type { McpServerConfig, McpServerInfo } from './types.js'
import { McpHttpClient, type FetchLike, type McpToolDef } from './http-client.js'

const CLIENT_INFO = { name: 'tuplet', version: '1.0.0' }

/** Content block shape returned by tools/call (subset we read). */
interface McpContentBlock {
  type?: string
  text?: string
  data?: string
  mimeType?: string
  resource?: { text?: string; uri?: string }
}

/** Tool names must match provider constraints (Anthropic/OpenAI): [A-Za-z0-9_-], <=64. */
export function sanitizeToolName(name: string): string {
  const cleaned = name.replace(/[^a-zA-Z0-9_-]/g, '_')
  return cleaned.length > 64 ? cleaned.slice(0, 64) : cleaned
}

/** Coerce an MCP input schema into Tuplet's JSONSchema (passed straight to the API). */
export function normalizeSchema(schema: unknown): JSONSchema {
  if (schema && typeof schema === 'object' && (schema as { type?: string }).type === 'object') {
    const s = schema as JSONSchema
    return { ...s, properties: s.properties ?? {} }
  }
  return { type: 'object', properties: {} }
}

/** Flatten tools/call content blocks into a single text string for the model. */
export function flattenContent(content: unknown): string {
  if (!Array.isArray(content)) return ''
  const parts: string[] = []
  for (const block of content as McpContentBlock[]) {
    if (!block || typeof block !== 'object') continue
    if (block.type === 'text' && typeof block.text === 'string') {
      parts.push(block.text)
    } else if (block.type === 'resource' && block.resource) {
      if (typeof block.resource.text === 'string') parts.push(block.resource.text)
      else if (block.resource.uri) parts.push(`[resource: ${block.resource.uri}]`)
    } else if (block.type === 'image') {
      parts.push(`[image${block.mimeType ? ` ${block.mimeType}` : ''}]`)
    } else {
      parts.push(JSON.stringify(block))
    }
  }
  return parts.join('\n')
}

export class McpConnection {
  readonly config: McpServerConfig
  private client: McpHttpClient | null = null
  private rawTools: McpToolDef[] = []
  private instructions?: string

  constructor(config: McpServerConfig) {
    this.config = config
  }

  get connected(): boolean {
    return this.client !== null
  }

  /**
   * Connect to the server and discover its tools.
   * @param fetchImpl Optional fetch override (custom auth, testing).
   */
  async connect(fetchImpl?: FetchLike): Promise<void> {
    const client = new McpHttpClient(this.config.url, this.config.headers ?? {}, fetchImpl)
    const { instructions } = await client.initialize(CLIENT_INFO)
    this.instructions = instructions
    this.rawTools = await client.listTools()
    this.client = client
  }

  private filteredTools(): McpToolDef[] {
    const { allowTools, denyTools } = this.config
    let list = this.rawTools
    if (allowTools) list = list.filter(t => allowTools.includes(t.name))
    if (denyTools) list = list.filter(t => !denyTools.includes(t.name))
    return list
  }

  /** Wrap this server's tools as Tuplet tools. Throws if not connected. */
  getTools(): Tool[] {
    const client = this.client
    if (!client) {
      throw new Error(`MCP server "${this.config.name}" is not connected — call connect() first`)
    }
    return this.filteredTools().map(raw => this.wrapTool(client, raw))
  }

  private wrapTool(client: McpHttpClient, raw: McpToolDef): Tool {
    const serverName = this.config.name
    const originalName = raw.name
    return {
      name: sanitizeToolName(`${serverName}__${originalName}`),
      description: raw.description || `${originalName} (via ${serverName} MCP server)`,
      parameters: normalizeSchema(raw.inputSchema),
      execute: async (params: Record<string, unknown>): Promise<ToolResult> => {
        try {
          const res = await client.callTool(originalName, params)
          const text = flattenContent(res.content)
          if (res.isError) {
            return { success: false, error: text || `MCP tool ${originalName} returned an error` }
          }
          return { success: true, data: text }
        } catch (err) {
          return { success: false, error: err instanceof Error ? err.message : String(err) }
        }
      },
    }
  }

  info(): McpServerInfo {
    return {
      name: this.config.name,
      description: this.config.description,
      instructions: this.instructions,
      toolCount: this.connected ? this.filteredTools().length : 0,
      connected: this.connected,
    }
  }

  async close(): Promise<void> {
    if (this.client) {
      await this.client.close()
      this.client = null
    }
  }
}
