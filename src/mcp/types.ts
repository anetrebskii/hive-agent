/**
 * MCP (Model Context Protocol) client types.
 *
 * Tuplet acts purely as an MCP *client* — it connects to existing remote MCP
 * servers and exposes their tools as native Tuplet tools. It does not implement
 * servers. Only the Streamable HTTP transport is supported (the transport used
 * by hosted servers such as HubSpot, Close, and Google Calendar).
 */

/** Remote MCP server reachable over Streamable HTTP. */
export interface McpServerConfig {
  /** Short identifier used to namespace this server's tools (e.g. 'hubspot'). */
  name: string
  /** Endpoint URL of the MCP server. */
  url: string
  /**
   * Sent on every request. Use for auth: bearer tokens, API keys, scope headers
   * (e.g. `{ Authorization: 'Bearer ...', 'Close-Scope': 'mcp.read' }`).
   */
  headers?: Record<string, string>
  /** Human description of what the server is for. Surfaced to the agent. */
  description?: string
  /** If set, only expose tools whose original (un-prefixed) name is listed. */
  allowTools?: string[]
  /** If set, hide tools whose original (un-prefixed) name is listed. */
  denyTools?: string[]
}

/** Summary of a connected server, used to build agent context. */
export interface McpServerInfo {
  name: string
  description?: string
  /** Usage instructions the server itself advertised on connect, if any. */
  instructions?: string
  /** Number of tools exposed after filtering. */
  toolCount: number
  connected: boolean
}
