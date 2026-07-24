/**
 * MCP manager — owns connections to multiple MCP servers and aggregates their
 * tools for a Tuplet agent.
 *
 * Lifecycle is host-managed (fits Tuplet's stateless design): construct once,
 * `connect()`, pass `getTools()` into TupletConfig, `close()` when done. The
 * host decides whether to reuse a manager across runs or connect per request.
 */

import type { Tool } from '../types.js'
import type { McpServerConfig, McpServerInfo } from './types.js'
import { McpConnection } from './client.js'

export class McpManager {
  private connections: McpConnection[]

  constructor(servers: McpServerConfig[]) {
    this.connections = servers.map(s => new McpConnection(s))
  }

  /**
   * Connect to all configured servers in parallel. If any fail, the successful
   * connections stay usable and an aggregate error is thrown listing failures —
   * catch it to run degraded, or let it surface.
   */
  async connect(): Promise<void> {
    const results = await Promise.allSettled(this.connections.map(c => c.connect()))
    const failures = results
      .map((r, i) =>
        r.status === 'rejected'
          ? `${this.connections[i].config.name}: ${r.reason instanceof Error ? r.reason.message : String(r.reason)}`
          : null
      )
      .filter((m): m is string => m !== null)
    if (failures.length > 0) {
      throw new Error(`Failed to connect MCP server(s):\n${failures.join('\n')}`)
    }
  }

  /** Aggregated tools from every connected server. Unconnected servers are skipped. */
  getTools(): Tool[] {
    return this.connections.filter(c => c.connected).flatMap(c => c.getTools())
  }

  /** Per-server summaries (name, description, tool count, connected state). */
  getServerInfo(): McpServerInfo[] {
    return this.connections.map(c => c.info())
  }

  /**
   * A system-prompt block describing the connected servers so the agent knows
   * what each is for. Append to the agent `role`, or register as a PromptSection.
   * Returns '' when nothing is connected.
   */
  getPromptSection(): string {
    const connected = this.connections.filter(c => c.connected)
    if (connected.length === 0) return ''

    const lines: string[] = [
      '## Connected MCP servers',
      '',
      'You have access to tools from the external MCP servers below. Tool names are prefixed with the server name. If a tool is not already listed, load it with __tool_search__ before calling it.',
      '',
    ]
    for (const c of connected) {
      const info = c.info()
      const heading = info.description ? `${info.name} — ${info.description}` : info.name
      lines.push(`### ${heading}`)
      lines.push(`- Tools: ${info.toolCount} (prefixed \`${info.name}__\`)`)
      if (info.instructions) {
        lines.push(`- Server notes: ${info.instructions.trim()}`)
      }
      lines.push('')
    }
    return lines.join('\n').trimEnd()
  }

  /** Close all connections. */
  async close(): Promise<void> {
    await Promise.allSettled(this.connections.map(c => c.close()))
  }
}
