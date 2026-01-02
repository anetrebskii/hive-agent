# Hive Agent

Minimal TypeScript agent framework inspired by Claude Code architecture.

## Features

- **Stateless design** - Works in Firebase Functions, serverless environments
- **No built-in tools** - You define your own tools
- **External history** - Accepts/returns conversation history (for Firestore, etc.)
- **Sub-agents** - Spawn specialized agents for complex tasks
- **Multi-provider** - Claude and OpenAI support, easily extensible
- **Interactive** - Built-in `__ask_user__` tool for clarifying questions
- **Progress tracking** - Todo lists and real-time progress callbacks
- **Prompt caching** - Claude prompt caching for cost reduction

## Installation

```bash
pnpm add @alexnetrebskii/hive-agent
```

## Quick Start

```typescript
import { Hive, ClaudeProvider } from '@alexnetrebskii/hive-agent'

const provider = new ClaudeProvider({
  apiKey: process.env.ANTHROPIC_API_KEY
})

const agent = new Hive({
  systemPrompt: 'You are a helpful assistant.',
  tools: [],
  llm: provider
})

const result = await agent.run('Hello!')
console.log(result.response)
```

## Defining Tools

```typescript
import type { Tool } from '@alexnetrebskii/hive-agent'

const weatherTool: Tool = {
  name: 'get_weather',
  description: 'Get current weather for a city',
  parameters: {
    type: 'object',
    properties: {
      city: { type: 'string', description: 'City name' }
    },
    required: ['city']
  },
  execute: async ({ city }) => {
    const weather = await fetchWeather(city)
    return { success: true, data: weather }
  }
}

const agent = new Hive({
  systemPrompt: 'You help users check weather.',
  tools: [weatherTool],
  llm: provider
})
```

## Sub-Agents

Spawn specialized agents for complex tasks:

```typescript
import type { SubAgentConfig } from '@alexnetrebskii/hive-agent'

const researchAgent: SubAgentConfig = {
  name: 'researcher',
  description: 'Research topics in depth using web search',
  systemPrompt: 'You research topics thoroughly and summarize findings.',
  tools: [webSearchTool, readUrlTool]
}

const agent = new Hive({
  systemPrompt: 'You help users with various tasks.',
  tools: [calculatorTool],
  agents: [researchAgent],
  llm: provider
})

// Agent can now use __task__ tool to delegate to researcher
const result = await agent.run('Research the latest AI developments')
```

### Per-Agent Providers

Each sub-agent can use different models or providers:

```typescript
import { ClaudeProvider, OpenAIProvider } from '@alexnetrebskii/hive-agent'

const claudeProvider = new ClaudeProvider({ apiKey: '...' })
const openaiProvider = new OpenAIProvider({ apiKey: '...', model: 'gpt-4o' })

const fastAgent: SubAgentConfig = {
  name: 'fast_helper',
  description: 'Quick tasks using GPT-4o',
  systemPrompt: '...',
  tools: [...],
  llm: openaiProvider,  // Uses OpenAI instead of parent's Claude
  maxIterations: 5
}

const agent = new Hive({
  systemPrompt: '...',
  tools: [...],
  agents: [fastAgent],
  llm: claudeProvider  // Main agent uses Claude
})
```

## Conversation History

### Automatic (with Repository Provider)

Pass a `conversationId` and Hive automatically loads/saves history:

```typescript
import { Hive, ClaudeProvider, MemoryRepository } from '@alexnetrebskii/hive-agent'

const agent = new Hive({
  systemPrompt: '...',
  tools: [...],
  llm: new ClaudeProvider({ apiKey: '...' }),
  repository: new MemoryRepository()  // Or your custom provider
})

// Hive automatically loads and saves history using conversationId
const result = await agent.run(userMessage, {
  conversationId: 'user-123-chat-456'  // Identity for the conversation
})

// Next message continues the conversation automatically
const result2 = await agent.run(nextMessage, {
  conversationId: 'user-123-chat-456'
})
```

### Custom Repository Provider

Implement `RepositoryProvider` for your database:

```typescript
import type { RepositoryProvider, Message } from '@alexnetrebskii/hive-agent'

class FirestoreRepository implements RepositoryProvider {
  constructor(private db: Firestore) {}

  async getHistory(conversationId: string): Promise<Message[]> {
    const doc = await this.db.collection('chats').doc(conversationId).get()
    return doc.exists ? doc.data()?.messages || [] : []
  }

  async saveHistory(conversationId: string, messages: Message[]): Promise<void> {
    await this.db.collection('chats').doc(conversationId).set({ messages })
  }
}

const agent = new Hive({
  systemPrompt: '...',
  tools: [...],
  llm: provider,
  repository: new FirestoreRepository(db)
})
```

### Manual History Management

Alternatively, manage history yourself:

```typescript
// Load history from database
const history = await db.collection('chats').doc(chatId).get()

// Run agent with history
const result = await agent.run(userMessage, {
  history: history.data()?.messages || []
})

// Save updated history
await db.collection('chats').doc(chatId).set({
  messages: result.history
})
```

## Interactive Questions

Agent can pause to ask clarifying questions:

```typescript
const result = await agent.run('Create a database schema')

if (result.status === 'needs_input') {
  // Show question to user
  console.log(result.pendingQuestion?.question)
  console.log(result.pendingQuestion?.options)

  // Save state and wait for user response
  // When user responds, run again with the same history
  const answer = await getUserInput()
  const continued = await agent.run(answer, { history: result.history })
}
```

## Interruption & Cancellation

Stop a running agent when user clicks "Stop" or sends a new message:

### Using AbortController (in-memory)

```typescript
const controller = new AbortController()

// Start agent
const resultPromise = agent.run(message, {
  conversationId,
  signal: controller.signal
})

// User clicks "Stop" button
controller.abort()

const result = await resultPromise
if (result.status === 'interrupted') {
  console.log(`Stopped after ${result.interrupted?.iterationsCompleted} iterations`)
  // result.history contains partial work
}
```

### Using Firestore (for Telegram bots)

```typescript
// Start task and store reference
const taskRef = db.collection('tasks').doc(taskId)
await taskRef.set({ status: 'running', chatId })

const result = await agent.run(message, {
  conversationId: chatId,
  shouldContinue: async () => {
    const doc = await taskRef.get()
    return doc.data()?.status === 'running'
  }
})

// Handle result
if (result.status === 'interrupted') {
  // User stopped or sent new message
  await sendMessage(chatId, 'Task stopped')
} else {
  await sendMessage(chatId, result.response)
}

// --- In another handler (when user clicks Stop or sends new message) ---
await taskRef.update({ status: 'stopped' })
```

### Continuing Partial Work

When interrupted, `result.history` contains the work done so far:

```typescript
const result = await agent.run(message, { signal })

if (result.status === 'interrupted') {
  // Option 1: Discard partial work, start fresh
  const fresh = await agent.run(newMessage, { conversationId })

  // Option 2: Continue from where we left off
  const continued = await agent.run(newMessage, {
    history: result.history  // Include partial work
  })
}
```

## Progress Callbacks

Get real-time feedback during execution:

```typescript
import { ConsoleLogger } from '@alexnetrebskii/hive-agent'

const logger = {
  ...new ConsoleLogger({ level: 'info' }),
  onProgress: (update) => {
    // update.type: 'thinking' | 'tool_start' | 'tool_end' | 'sub_agent_start' | 'sub_agent_end'
    console.log(`${update.type}: ${update.message}`)
  }
}

const agent = new Hive({
  systemPrompt: '...',
  tools: [...],
  llm: provider,
  logger
})
```

## Prompt Caching (Claude)

Reduce costs with Claude's prompt caching:

```typescript
const result = await agent.run(message, {
  history,
  cache: {
    enabled: true,
    cacheSystemPrompt: true,  // Cache system prompt
    cacheTools: true,         // Cache tool definitions
    cacheHistory: true        // Cache conversation history
  }
})

// Check cache usage
console.log(result.usage?.cacheReadInputTokens)
console.log(result.usage?.cacheCreationInputTokens)
```

## Configuration

```typescript
interface HiveConfig {
  systemPrompt: string
  tools: Tool[]
  agents?: SubAgentConfig[]

  llm: LLMProvider
  logger?: LogProvider
  repository?: RepositoryProvider

  maxIterations?: number        // Default: 50
  maxContextTokens?: number     // Default: 100000
  contextStrategy?: 'truncate_old' | 'summarize' | 'error'

  thinkingMode?: 'none' | 'enabled'
  thinkingBudget?: number

  review?: ReviewConfig
}
```

## Providers

### Claude (Anthropic)

```typescript
import { ClaudeProvider } from '@alexnetrebskii/hive-agent'

const provider = new ClaudeProvider({
  apiKey: process.env.ANTHROPIC_API_KEY,
  model: 'claude-sonnet-4-20250514',  // Default
  maxTokens: 8192
})
```

### OpenAI

```typescript
import { OpenAIProvider } from '@alexnetrebskii/hive-agent'

const provider = new OpenAIProvider({
  apiKey: process.env.OPENAI_API_KEY,
  model: 'gpt-4o',  // Default
  maxTokens: 4096,
  baseURL: 'https://api.openai.com/v1'  // Optional, for proxies
})
```

## API Reference

### AgentResult

```typescript
interface AgentResult {
  response: string              // Final text response
  history: Message[]            // Full conversation history
  toolCalls: ToolCallLog[]      // Log of all tool invocations
  thinking?: string[]           // Thinking blocks (if enabled)
  todos?: TodoItem[]            // Current todo list
  pendingQuestion?: PendingQuestion  // If status is 'needs_input'
  status: 'complete' | 'needs_input'
  usage?: {
    totalInputTokens: number
    totalOutputTokens: number
    cacheCreationInputTokens?: number
    cacheReadInputTokens?: number
  }
}
```

### Tool

```typescript
interface Tool {
  name: string
  description: string
  parameters: JSONSchema
  execute: (params: Record<string, unknown>, context: ToolContext) => Promise<ToolResult>
}

interface ToolResult {
  success: boolean
  data?: unknown
  error?: string
}

interface ToolContext {
  remainingTokens: number
  conversationId?: string
  userId?: string
  metadata?: Record<string, unknown>
}
```

## License

MIT
