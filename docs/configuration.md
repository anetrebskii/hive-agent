# Configuration

Complete reference for Hive configuration options.

## HiveConfig

```typescript
interface HiveConfig {
  // Required
  systemPrompt: string          // Agent's instructions
  tools: Tool[]                 // Available tools
  llm: LLMProvider             // LLM provider (Claude, OpenAI, custom)

  // Sub-agents
  agents?: SubAgentConfig[]     // Specialized sub-agents

  // Providers
  logger?: LogProvider          // Logging and progress callbacks
  repository?: RepositoryProvider  // History persistence

  // Limits
  maxIterations?: number        // Max tool loops (default: 50)
  maxContextTokens?: number     // Max context size (default: 100000)
  contextStrategy?: 'truncate_old' | 'summarize' | 'error'

  // Built-in tools
  disableAskUser?: boolean      // Disable __ask_user__ tool

  // Tracing
  trace?: TraceProvider         // Execution tracing
  agentName?: string            // Root agent name (default: 'agent')
  modelPricing?: Record<string, ModelPricing>  // Custom pricing
}
```

## SubAgentConfig

```typescript
interface SubAgentConfig {
  name: string                  // Unique identifier
  description: string           // Shown to parent agent
  systemPrompt: string          // Sub-agent's instructions
  tools: Tool[]                 // Available tools

  // Overrides
  model?: string                // Override model
  llm?: LLMProvider             // Override provider
  maxIterations?: number        // Override iteration limit

  // Structured I/O
  inputSchema?: JSONSchema      // Structured input parameters
  outputSchema?: JSONSchema     // Structured output data
}
```

## RunOptions

```typescript
interface RunOptions {
  // Conversation
  conversationId?: string       // For repository persistence
  userId?: string               // Passed to tools
  history?: Message[]           // Manual history management

  // Shared data
  context?: Context             // Shared context for tools/agents

  // Cancellation
  signal?: AbortSignal          // AbortController signal
  shouldContinue?: () => Promise<boolean>  // Async check function
}
```

## Example: Full Configuration

```typescript
import {
  Hive,
  ClaudeProvider,
  ConsoleLogger,
  ConsoleTraceProvider,
  MemoryRepository,
  Context
} from '@alexnetrebskii/hive-agent'

const agent = new Hive({
  // System prompt
  systemPrompt: `You are a helpful assistant.

## Available Tools
- search: Search the web
- calculate: Do math

## Guidelines
- Be concise and helpful
- Ask clarifying questions when needed`,

  // Tools
  tools: [searchTool, calculateTool],

  // Sub-agents
  agents: [
    {
      name: 'researcher',
      description: 'Deep research on topics',
      systemPrompt: '...',
      tools: [webSearchTool, readUrlTool],
      model: 'claude-3-haiku-20240307',
      maxIterations: 10
    }
  ],

  // LLM
  llm: new ClaudeProvider({
    apiKey: process.env.ANTHROPIC_API_KEY,
    model: 'claude-sonnet-4-20250514'
  }),

  // Logging
  logger: new ConsoleLogger({ level: 'info' }),

  // History persistence
  repository: new MemoryRepository(),

  // Limits
  maxIterations: 25,
  maxContextTokens: 50000,
  contextStrategy: 'truncate_old',

  // Tracing
  trace: new ConsoleTraceProvider({ showCosts: true }),
  agentName: 'main_agent'
})
```

## Example: Run with Options

```typescript
const context = new Context({
  paths: {
    'result/data.json': { type: 'object', required: ['status'] }
  }
})

const controller = new AbortController()

const result = await agent.run('Analyze this data', {
  conversationId: 'user-123-chat-456',
  userId: 'user-123',
  context,
  signal: controller.signal
})
```

## Context Strategy

Controls behavior when context exceeds `maxContextTokens`:

- `truncate_old` (default): Remove oldest messages
- `summarize`: Summarize old messages (not yet implemented)
- `error`: Throw an error

```typescript
const agent = new Hive({
  systemPrompt: '...',
  tools: [...],
  llm: provider,
  maxContextTokens: 50000,
  contextStrategy: 'truncate_old'
})
```

## Logger Configuration

```typescript
import { ConsoleLogger } from '@alexnetrebskii/hive-agent'

const logger = new ConsoleLogger({
  level: 'info',      // 'debug' | 'info' | 'warn' | 'error'
  prefix: '[Agent]'   // Optional prefix
})

// Or custom logger
const customLogger = {
  debug: (msg, data) => console.debug(msg, data),
  info: (msg, data) => console.info(msg, data),
  warn: (msg, data) => console.warn(msg, data),
  error: (msg, data) => console.error(msg, data),

  // Optional callbacks
  onToolCall: (name, params) => { /* ... */ },
  onToolResult: (name, result, durationMs) => { /* ... */ },
  onIteration: (iteration, messageCount) => { /* ... */ },
  onComplete: (result) => { /* ... */ },
  onProgress: (update) => { /* ... */ }
}
```

## Progress Updates

```typescript
interface ProgressUpdate {
  type: 'thinking' | 'tool_start' | 'tool_end' | 'sub_agent_start' | 'sub_agent_end' | 'status'
  message: string
  details?: {
    toolName?: string
    agentName?: string
    duration?: number
    success?: boolean
  }
}

const logger = {
  ...new ConsoleLogger({ level: 'warn' }),
  onProgress: (update) => {
    switch (update.type) {
      case 'thinking':
        showSpinner('Thinking...')
        break
      case 'tool_start':
        showSpinner(`Running ${update.details?.toolName}...`)
        break
      case 'tool_end':
        hideSpinner()
        break
    }
  }
}
```

## Environment Variables

Common environment setup:

```bash
# .env
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...
```

```typescript
import 'dotenv/config'

const provider = new ClaudeProvider({
  apiKey: process.env.ANTHROPIC_API_KEY!
})
```
