/**
 * MCP (Model Context Protocol) client integration.
 *
 * Connect Tuplet to existing remote MCP servers and expose their tools to the
 * agent. Zero-dependency Streamable HTTP client.
 */

export { McpManager } from './manager.js'
export { McpConnection, sanitizeToolName, normalizeSchema, flattenContent } from './client.js'
export { McpHttpClient, parseSseMessages, type FetchLike, type McpToolDef, type McpCallResult } from './http-client.js'
export type { McpServerConfig, McpServerInfo } from './types.js'
