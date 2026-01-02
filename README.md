# Hive Agent

Minimal TypeScript agent framework inspired by Claude Code architecture.

## Features

- **Stateless design** - Works in Firebase Functions, serverless environments
- **No built-in tools** - You define your own tools
- **External history** - Accepts/returns conversation history (for Firestore, etc.)
- **Sub-agents** - Spawn specialized agents for complex tasks
- **Structured I/O** - Type-safe input/output schemas for sub-agents
- **Multi-provider** - Claude and OpenAI support, easily extensible
- **Interactive** - Built-in `__ask_user__` tool for clarifying questions
- **Progress tracking** - Todo lists and real-time progress callbacks
- **Execution tracing** - Full hierarchy tracking with cost breakdown
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

### Structured Sub-Agents

Define input/output schemas for type-safe, cost-efficient sub-agent communication:

```typescript
import type { SubAgentConfig } from '@alexnetrebskii/hive-agent'

const nutritionAgent: SubAgentConfig = {
  name: 'nutrition_counter',
  description: 'Log food and calculate nutrition values',

  // Input schema - parent provides structured parameters
  inputSchema: {
    type: 'object',
    properties: {
      food: { type: 'string', description: 'Food item to log' },
      portionGrams: { type: 'number', description: 'Portion size in grams' },
      meal: { type: 'string', description: 'Meal type: breakfast, lunch, dinner, snack' }
    },
    required: ['food', 'portionGrams', 'meal']
  },

  // Output schema - sub-agent returns structured data via __output__ tool
  outputSchema: {
    type: 'object',
    properties: {
      logged: { type: 'boolean', description: 'Whether food was logged' },
      calories: { type: 'number', description: 'Total calories' },
      protein: { type: 'number', description: 'Protein in grams' }
    },
    required: ['logged', 'calories']
  },

  systemPrompt: `You log food nutrition. Use __output__ to return results.`,
  tools: [searchFoodTool, logMealTool]
}

const agent = new Hive({
  systemPrompt: 'You are a nutrition consultant.',
  tools: [],
  agents: [nutritionAgent],
  llm: provider
})

// Main agent calls sub-agent with structured input:
// __task__({ agent: "nutrition_counter", food: "pasta", portionGrams: 250, meal: "lunch" })
//
// Sub-agent returns structured output:
// { summary: "Logged 250g pasta...", data: { logged: true, calories: 350, protein: 12 } }
```

## Execution Tracing

Track the full execution hierarchy with cost breakdown:

```typescript
import { Hive, ClaudeProvider, ConsoleTraceProvider } from '@alexnetrebskii/hive-agent'

const agent = new Hive({
  systemPrompt: '...',
  tools: [...],
  agents: [...],
  llm: new ClaudeProvider({ apiKey: '...' }),
  trace: new ConsoleTraceProvider({ showCosts: true }),
  agentName: 'my_agent'
})

const result = await agent.run('Do something complex')

// ConsoleTraceProvider outputs execution tree to console:
// [TRACE START] trace_abc123 - my_agent
// [AGENT START] my_agent
// [LLM] claude:claude-sonnet-4-20250514 - 1250 in / 89 out - $0.0042
// [TOOL] search_food (125ms)
// [AGENT START] nutrition_counter
// [LLM] claude:claude-3-haiku-20240307 - 800 in / 45 out - $0.0003
// [TOOL] log_meal (52ms)
// [AGENT END] nutrition_counter - complete
// [AGENT END] my_agent - complete
// [TRACE END] trace_abc123 - 2.3s - $0.0045
```

### Custom Trace Provider

Implement `TraceProvider` for custom logging (database, observability platforms):

```typescript
import type { TraceProvider, Trace, AgentSpan, LLMCallEvent, ToolCallEvent } from '@alexnetrebskii/hive-agent'

class DatadogTraceProvider implements TraceProvider {
  onTraceStart(trace: Trace): void {
    // Start a Datadog trace
  }

  onTraceEnd(trace: Trace): void {
    // End trace, record total cost
    datadogClient.gauge('agent.cost', trace.totalCost)
  }

  onAgentStart(span: AgentSpan, trace: Trace): void {
    // Start agent span
  }

  onAgentEnd(span: AgentSpan, trace: Trace): void {
    // End agent span with status
  }

  onLLMCall(event: LLMCallEvent, span: AgentSpan, trace: Trace): void {
    // Record LLM call metrics
    datadogClient.increment('agent.llm_calls', { model: event.modelId })
  }

  onToolCall(event: ToolCallEvent, span: AgentSpan, trace: Trace): void {
    // Record tool call metrics
    datadogClient.histogram('agent.tool_duration', event.durationMs)
  }
}
```

### Accessing Trace Data

The trace is available in the result for programmatic access:

```typescript
const result = await agent.run(message)

if (result.trace) {
  console.log(`Total cost: $${result.trace.totalCost.toFixed(4)}`)
  console.log(`Duration: ${result.trace.durationMs}ms`)

  // Walk the execution tree
  function printSpan(span: AgentSpan, depth = 0) {
    const indent = '  '.repeat(depth)
    console.log(`${indent}${span.agentName}: ${span.events.length} events`)
    for (const child of span.children) {
      printSpan(child, depth + 1)
    }
  }
  printSpan(result.trace.rootSpan)
}
```

### Usage by Model

Track token usage broken down by provider and model:

```typescript
const result = await agent.run(message)

// Aggregated usage by model (includes sub-agents)
if (result.usageByModel) {
  for (const [modelId, usage] of Object.entries(result.usageByModel)) {
    console.log(`${modelId}:`)
    console.log(`  ${usage.inputTokens} input / ${usage.outputTokens} output`)
    console.log(`  ${usage.calls} API calls`)
    if (usage.cacheReadInputTokens) {
      console.log(`  ${usage.cacheReadInputTokens} tokens from cache`)
    }
  }
}
// Output:
// claude:claude-sonnet-4-20250514:
//   2500 input / 180 output
//   2 API calls
// claude:claude-3-haiku-20240307:
//   800 input / 45 output
//   1 API calls
//   650 tokens from cache
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

### Redis Repository Example

```typescript
import type { RepositoryProvider, Message } from '@alexnetrebskii/hive-agent'
import { Redis } from 'ioredis'

class RedisRepository implements RepositoryProvider {
  constructor(private redis: Redis, private ttlSeconds = 86400) {}

  async getHistory(conversationId: string): Promise<Message[]> {
    const data = await this.redis.get(`chat:${conversationId}`)
    return data ? JSON.parse(data) : []
  }

  async saveHistory(conversationId: string, messages: Message[]): Promise<void> {
    await this.redis.setex(
      `chat:${conversationId}`,
      this.ttlSeconds,
      JSON.stringify(messages)
    )
  }
}
```

### PostgreSQL Repository Example

```typescript
import type { RepositoryProvider, Message } from '@alexnetrebskii/hive-agent'
import { Pool } from 'pg'

class PostgresRepository implements RepositoryProvider {
  constructor(private pool: Pool) {}

  async getHistory(conversationId: string): Promise<Message[]> {
    const result = await this.pool.query(
      'SELECT messages FROM conversations WHERE id = $1',
      [conversationId]
    )
    return result.rows[0]?.messages || []
  }

  async saveHistory(conversationId: string, messages: Message[]): Promise<void> {
    await this.pool.query(
      `INSERT INTO conversations (id, messages, updated_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (id) DO UPDATE SET messages = $2, updated_at = NOW()`,
      [conversationId, JSON.stringify(messages)]
    )
  }
}
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

Reduce costs by up to 90% with Claude's prompt caching. Cached tokens are billed at 1/10th the price of regular input tokens.

```typescript
import { ClaudeProvider } from '@alexnetrebskii/hive-agent'

const provider = new ClaudeProvider({
  apiKey: process.env.ANTHROPIC_API_KEY,
  cache: true  // Enable caching for system prompt, tools, and history
})

const agent = new Hive({
  systemPrompt: '...',
  tools: [...],
  llm: provider
})

const result = await agent.run(message)

// Check cache usage
if (result.usage) {
  console.log(`Cache write: ${result.usage.cacheCreationInputTokens || 0} tokens`)
  console.log(`Cache read: ${result.usage.cacheReadInputTokens || 0} tokens`)
}
```

### How It Works

- **First request**: Tokens are written to cache (`cacheCreationInputTokens`)
- **Subsequent requests**: Tokens are read from cache (`cacheReadInputTokens`) at 1/10th cost
- **Cache TTL**: 5 minutes (automatically extended on each hit)

Cache breakpoints are automatically placed at optimal positions (system prompt, tools, last user message).

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

  // Tracing
  trace?: TraceProvider         // Enable execution tracing
  agentName?: string            // Name for root agent span (default: 'agent')
  modelPricing?: Record<string, ModelPricing>  // Custom pricing overrides
}

interface SubAgentConfig {
  name: string
  description: string
  systemPrompt: string
  tools: Tool[]
  model?: string                // Override model for this agent
  llm?: LLMProvider             // Override provider for this agent
  maxIterations?: number        // Override max iterations
  inputSchema?: JSONSchema      // Structured input parameters
  outputSchema?: JSONSchema     // Structured output data
}
```

## Providers

### Claude (Anthropic)

```typescript
import { ClaudeProvider } from '@alexnetrebskii/hive-agent'

const provider = new ClaudeProvider({
  apiKey: process.env.ANTHROPIC_API_KEY,
  model: 'claude-sonnet-4-20250514',  // Default
  maxTokens: 8192,
  cache: true                         // Enable prompt caching
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
  status: 'complete' | 'needs_input' | 'interrupted'
  interrupted?: {
    reason: 'aborted' | 'stopped' | 'max_iterations'
    iterationsCompleted: number
  }
  usage?: {
    totalInputTokens: number
    totalOutputTokens: number
    cacheCreationInputTokens?: number
    cacheReadInputTokens?: number
  }
  usageByModel?: Record<string, {  // Usage by provider:model
    inputTokens: number
    outputTokens: number
    cacheCreationInputTokens?: number
    cacheReadInputTokens?: number
    calls: number
  }>
  trace?: Trace                 // Execution trace (if TraceProvider configured)
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

### RepositoryProvider

```typescript
interface RepositoryProvider {
  // Required: Load conversation history
  getHistory(conversationId: string): Promise<Message[]>

  // Required: Save conversation history
  saveHistory(conversationId: string, messages: Message[]): Promise<void>

  // Optional: Custom state storage
  getState?(conversationId: string): Promise<Record<string, unknown> | null>
  saveState?(conversationId: string, state: Record<string, unknown>): Promise<void>

  // Optional: Caching layer
  getCached?(key: string): Promise<unknown | null>
  setCached?(key: string, value: unknown, ttlMs?: number): Promise<void>
}
```

## License

MIT
