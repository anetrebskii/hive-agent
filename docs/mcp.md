# MCP Servers

Tuplet is an MCP (Model Context Protocol) **client**. It connects to existing
remote MCP servers, discovers their tools, and exposes them to the agent as
native Tuplet tools. You don't build or host any server.

The client is a zero-dependency Streamable HTTP implementation — no
`@modelcontextprotocol/sdk` required. Only the **Streamable HTTP** transport is
supported, which is what hosted servers use:

| Service | Endpoint | Auth |
|---|---|---|
| HubSpot | `https://mcp.hubspot.com` | OAuth, or bearer token header |
| Close CRM | `https://mcp.close.com/mcp` | OAuth, or API key via `Authorization` + `Close-Scope` headers |
| Google Calendar | `https://calendarmcp.googleapis.com/mcp/v1` | OAuth 2.0 |

> stdio (local subprocess) and legacy HTTP+SSE transports are not supported.

## Quick start

```ts
import { Tuplet, ClaudeProvider, McpManager } from 'tuplet'

const mcp = new McpManager([
  {
    name: 'hubspot',
    description: 'HubSpot CRM — contacts, companies, deals',
    url: 'https://mcp.hubspot.com',
    headers: { Authorization: `Bearer ${process.env.HUBSPOT_TOKEN}` },
  },
  {
    name: 'close',
    description: 'Close CRM — leads and opportunities',
    url: 'https://mcp.close.com/mcp',
    headers: {
      Authorization: `Bearer ${process.env.CLOSE_API_KEY}`,
      'Close-Scope': 'mcp.read',
    },
  },
])

await mcp.connect()

const agent = new Tuplet({
  role: 'a sales assistant that works across HubSpot and Close',
  llm: new ClaudeProvider({ apiKey: process.env.ANTHROPIC_API_KEY! }),
  tools: [...mcp.getTools()],
})

const result = await agent.run('Find the HubSpot contact for acme.com and summarize their deals')
console.log(result.response)

await mcp.close()
```

## How tools appear to the agent

- Each MCP tool is namespaced `${server}__${tool}` (e.g. `hubspot__crm_list_contacts`)
  so tools from different servers never collide.
- The MCP `inputSchema` is passed straight through as the tool's parameters.
- Tool results (text / resource / image content blocks) are flattened to text.
- MCP tools are **deferred** — they don't inflate the system prompt. The model
  loads the ones it needs on demand via the built-in `__tool_search__` tool. A
  server exposing 40 tools costs almost nothing until those tools are used.

## Telling the agent what's connected

`getTools()` gives the agent the tools, but not the *context* of which server is
which. Wire `getPromptSection()` into the system prompt so the model knows what
each server is for (it includes each server's description, tool count, and any
usage instructions the server itself advertised):

```ts
const agent = new Tuplet({
  role: `a sales assistant.\n\n${mcp.getPromptSection()}`,
  llm,
  tools: [...mcp.getTools()],
})
```

Produces, for example:

```
## Connected MCP servers

You have access to tools from the external MCP servers below. ...

### hubspot — HubSpot CRM — contacts, companies, deals
- Tools: 12 (prefixed `hubspot__`)

### close — Close CRM — leads and opportunities
- Tools: 8 (prefixed `close__`)
```

## Filtering tools

Large servers may expose more tools than you want. Restrict per server:

```ts
{ name: 'hubspot', url: '...', allowTools: ['crm_list_contacts', 'crm_get_deal'] }
// or
{ name: 'hubspot', url: '...', denyTools: ['crm_delete_contact'] }
```

Names in `allowTools` / `denyTools` are the server's original (un-prefixed) tool
names.

## Auth

Auth is header pass-through: whatever the server needs, put it in `headers`.
These are sent on every request. Interactive browser OAuth flows are out of
scope — obtain a token however your app does (OAuth exchange, API key) and pass
it as a bearer or custom header. Servers that support API keys (e.g. Close) are
the simplest to use from a backend.

## Lifecycle

`McpManager` is host-managed, which fits Tuplet's stateless design:

- **Long-lived server**: construct the manager once, `connect()` at startup,
  reuse `getTools()` across many `agent.run(...)` calls, `close()` on shutdown.
- **Serverless / per-request**: construct and `connect()` at the start of the
  request, `close()` at the end. `connect()` runs the servers in parallel.

If a server fails to connect, `connect()` still connects the rest and throws an
aggregate error listing the failures. Catch it to run degraded — `getTools()`
and `getPromptSection()` only include servers that actually connected.

## API

```ts
new McpManager(servers: McpServerConfig[])
  .connect(): Promise<void>
  .getTools(): Tool[]
  .getServerInfo(): McpServerInfo[]
  .getPromptSection(): string
  .close(): Promise<void>

interface McpServerConfig {
  name: string                       // namespace for this server's tools
  url: string                        // Streamable HTTP endpoint
  headers?: Record<string, string>   // auth / scope headers
  description?: string               // surfaced to the agent
  allowTools?: string[]              // only expose these (original names)
  denyTools?: string[]               // hide these (original names)
}
```

For a single server you can use `McpConnection` directly; it takes the same
config and exposes `connect()`, `getTools()`, `info()`, and `close()`.
