# Execution Tracing

Track the full execution hierarchy with cost breakdown across agents, LLM calls, and tool invocations.

## Quick Start

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
```

## Console Output

`ConsoleTraceProvider` outputs an execution tree with input/output message previews:

```text
━━━ Trace: trace_1704067200000_abc123 ━━━
🤖 my_agent started
   ↳ Do something complex
  ⚡ my_agent → LLM: claude-sonnet-4-20250514 (1250/89 tokens, 850ms, $0.004200)
  🔧 my_agent → search_food ✓ (125ms)
  🔹 my_agent → nutrition_counter started
     ↳ Task parameters: { "food": "chicken", "portionGrams": 200 }
    ⚡ my_agent → nutrition_counter → LLM: claude-3-haiku-20240307 (800/45 tokens, 320ms, $0.000300)
    🔧 my_agent → nutrition_counter → log_meal ✓ (52ms)
  ✓ my_agent → nutrition_counter completed (520ms, $0.000300)
     ↳ Logged 200g chicken for lunch: 330 kcal
✓ my_agent completed (2300ms, $0.004500)
   ↳ I've logged your chicken. That's 330 calories with 62g protein.

━━━ Trace Complete ━━━
Duration: 2300ms
Total LLM calls: 2
Total tool calls: 2
Total tokens: 2050 in / 134 out [cache: +0 write, 650 read]
Total cost: $0.004500
```

## Custom Trace Provider

Implement `TraceProvider` to send traces to databases, observability platforms, or custom logging systems.

### TraceProvider Interface

```typescript
import type {
  TraceProvider,
  Trace,
  AgentSpan,
  LLMCallEvent,
  ToolCallEvent,
  ModelPricing
} from '@alexnetrebskii/hive-agent'

interface TraceProvider {
  // Called when a new trace starts
  onTraceStart(trace: Trace): void

  // Called when the trace completes
  onTraceEnd(trace: Trace): void

  // Called when an agent (root or sub-agent) starts
  onAgentStart(span: AgentSpan, trace: Trace): void

  // Called when an agent completes
  onAgentEnd(span: AgentSpan, trace: Trace): void

  // Called after each LLM API call
  onLLMCall(event: LLMCallEvent, span: AgentSpan, trace: Trace): void

  // Called after each tool execution
  onToolCall(event: ToolCallEvent, span: AgentSpan, trace: Trace): void

  // Optional: custom model pricing for cost calculation
  modelPricing?: Record<string, ModelPricing>
}
```

### Example: Datadog Integration

```typescript
import type {
  TraceProvider,
  Trace,
  AgentSpan,
  LLMCallEvent,
  ToolCallEvent
} from '@alexnetrebskii/hive-agent'
import { datadogClient } from './datadog'

class DatadogTraceProvider implements TraceProvider {
  private spans = new Map<string, any>()

  onTraceStart(trace: Trace): void {
    // Start a Datadog root span
    const ddSpan = datadogClient.startSpan('agent.trace', {
      tags: { traceId: trace.traceId }
    })
    this.spans.set(trace.traceId, ddSpan)
  }

  onTraceEnd(trace: Trace): void {
    // Record final metrics and close span
    datadogClient.gauge('agent.cost', trace.totalCost)
    datadogClient.gauge('agent.duration_ms', trace.durationMs)
    datadogClient.gauge('agent.llm_calls', trace.totalLLMCalls)
    datadogClient.gauge('agent.tool_calls', trace.totalToolCalls)

    const ddSpan = this.spans.get(trace.traceId)
    ddSpan?.finish()
    this.spans.delete(trace.traceId)
  }

  onAgentStart(span: AgentSpan, trace: Trace): void {
    // Start child span for agent
    const parentSpan = this.spans.get(span.parentSpanId || trace.traceId)
    const ddSpan = datadogClient.startSpan('agent.run', {
      childOf: parentSpan,
      tags: {
        agentName: span.agentName,
        depth: span.depth,
        inputMessage: span.inputMessage?.slice(0, 200)
      }
    })
    this.spans.set(span.spanId, ddSpan)
  }

  onAgentEnd(span: AgentSpan, trace: Trace): void {
    const ddSpan = this.spans.get(span.spanId)
    if (ddSpan) {
      ddSpan.setTag('status', span.status)
      ddSpan.setTag('cost', span.totalCost)
      ddSpan.setTag('outputResponse', span.outputResponse?.slice(0, 200))
      ddSpan.finish()
    }
    this.spans.delete(span.spanId)
  }

  onLLMCall(event: LLMCallEvent, span: AgentSpan, trace: Trace): void {
    datadogClient.increment('agent.llm_calls', {
      model: event.modelId,
      agent: span.agentName
    })
    datadogClient.histogram('agent.llm_duration', event.durationMs)
    datadogClient.gauge('agent.llm_cost', event.cost)
  }

  onToolCall(event: ToolCallEvent, span: AgentSpan, trace: Trace): void {
    datadogClient.increment('agent.tool_calls', {
      tool: event.toolName,
      agent: span.agentName,
      success: event.output.success
    })
    datadogClient.histogram('agent.tool_duration', event.durationMs)
  }
}
```

### Example: Database Logger

```typescript
import type {
  TraceProvider,
  Trace,
  AgentSpan,
  LLMCallEvent,
  ToolCallEvent
} from '@alexnetrebskii/hive-agent'
import { Pool } from 'pg'

class PostgresTraceProvider implements TraceProvider {
  constructor(private db: Pool) {}

  onTraceStart(trace: Trace): void {
    // Insert trace record (will be updated on end)
    this.db.query(
      `INSERT INTO agent_traces (trace_id, start_time, status)
       VALUES ($1, $2, 'running')`,
      [trace.traceId, new Date(trace.startTime)]
    )
  }

  onTraceEnd(trace: Trace): void {
    this.db.query(
      `UPDATE agent_traces SET
         end_time = $2,
         duration_ms = $3,
         total_cost = $4,
         total_llm_calls = $5,
         total_tool_calls = $6,
         total_input_tokens = $7,
         total_output_tokens = $8,
         status = 'complete',
         root_span = $9
       WHERE trace_id = $1`,
      [
        trace.traceId,
        new Date(trace.endTime!),
        trace.durationMs,
        trace.totalCost,
        trace.totalLLMCalls,
        trace.totalToolCalls,
        trace.totalInputTokens,
        trace.totalOutputTokens,
        JSON.stringify(trace.rootSpan)
      ]
    )
  }

  onAgentStart(span: AgentSpan, trace: Trace): void {
    this.db.query(
      `INSERT INTO agent_spans
         (span_id, trace_id, parent_span_id, agent_name, depth, start_time, input_message, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'running')`,
      [
        span.spanId,
        trace.traceId,
        span.parentSpanId,
        span.agentName,
        span.depth,
        new Date(span.startTime),
        span.inputMessage
      ]
    )
  }

  onAgentEnd(span: AgentSpan, trace: Trace): void {
    this.db.query(
      `UPDATE agent_spans SET
         end_time = $2,
         duration_ms = $3,
         status = $4,
         output_response = $5,
         total_cost = $6,
         total_llm_calls = $7,
         total_tool_calls = $8
       WHERE span_id = $1`,
      [
        span.spanId,
        new Date(span.endTime!),
        span.durationMs,
        span.status,
        span.outputResponse,
        span.totalCost,
        span.totalLLMCalls,
        span.totalToolCalls
      ]
    )
  }

  onLLMCall(event: LLMCallEvent, span: AgentSpan, trace: Trace): void {
    this.db.query(
      `INSERT INTO llm_calls
         (span_id, trace_id, agent_name, model_id, input_tokens, output_tokens,
          cache_creation_tokens, cache_read_tokens, cost, duration_ms, timestamp)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        event.spanId,
        trace.traceId,
        span.agentName,
        event.modelId,
        event.inputTokens,
        event.outputTokens,
        event.cacheCreationTokens,
        event.cacheReadTokens,
        event.cost,
        event.durationMs,
        new Date(event.timestamp)
      ]
    )
  }

  onToolCall(event: ToolCallEvent, span: AgentSpan, trace: Trace): void {
    this.db.query(
      `INSERT INTO tool_calls
         (span_id, trace_id, agent_name, tool_name, input, output, success, duration_ms, timestamp)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        event.spanId,
        trace.traceId,
        span.agentName,
        event.toolName,
        JSON.stringify(event.input),
        JSON.stringify(event.output),
        event.output.success,
        event.durationMs,
        new Date(event.timestamp)
      ]
    )
  }
}
```

### Example: Simple File Logger

```typescript
import type {
  TraceProvider,
  Trace,
  AgentSpan,
  LLMCallEvent,
  ToolCallEvent
} from '@alexnetrebskii/hive-agent'
import { appendFileSync } from 'fs'

class FileTraceProvider implements TraceProvider {
  constructor(private filePath: string) {}

  private log(data: object): void {
    appendFileSync(this.filePath, JSON.stringify(data) + '\n')
  }

  onTraceStart(trace: Trace): void {
    this.log({ event: 'trace_start', traceId: trace.traceId, timestamp: trace.startTime })
  }

  onTraceEnd(trace: Trace): void {
    this.log({
      event: 'trace_end',
      traceId: trace.traceId,
      durationMs: trace.durationMs,
      totalCost: trace.totalCost,
      totalLLMCalls: trace.totalLLMCalls,
      totalToolCalls: trace.totalToolCalls,
      costByModel: trace.costByModel
    })
  }

  onAgentStart(span: AgentSpan, trace: Trace): void {
    this.log({
      event: 'agent_start',
      traceId: trace.traceId,
      spanId: span.spanId,
      agentName: span.agentName,
      depth: span.depth,
      inputMessage: span.inputMessage
    })
  }

  onAgentEnd(span: AgentSpan, trace: Trace): void {
    this.log({
      event: 'agent_end',
      traceId: trace.traceId,
      spanId: span.spanId,
      agentName: span.agentName,
      status: span.status,
      durationMs: span.durationMs,
      totalCost: span.totalCost,
      outputResponse: span.outputResponse
    })
  }

  onLLMCall(event: LLMCallEvent, span: AgentSpan, trace: Trace): void {
    this.log({
      event: 'llm_call',
      traceId: trace.traceId,
      spanId: span.spanId,
      agentName: span.agentName,
      modelId: event.modelId,
      inputTokens: event.inputTokens,
      outputTokens: event.outputTokens,
      cost: event.cost,
      durationMs: event.durationMs
    })
  }

  onToolCall(event: ToolCallEvent, span: AgentSpan, trace: Trace): void {
    this.log({
      event: 'tool_call',
      traceId: trace.traceId,
      spanId: span.spanId,
      agentName: span.agentName,
      toolName: event.toolName,
      success: event.output.success,
      durationMs: event.durationMs
    })
  }
}
```

## Accessing Trace Data

The trace is available in the result for programmatic access:

```typescript
const result = await agent.run(message)

if (result.trace) {
  console.log(`Total cost: $${result.trace.totalCost.toFixed(4)}`)
  console.log(`Duration: ${result.trace.durationMs}ms`)
  console.log(`LLM calls: ${result.trace.totalLLMCalls}`)
  console.log(`Tool calls: ${result.trace.totalToolCalls}`)

  // Walk the execution tree
  function printSpan(span: AgentSpan, depth = 0) {
    const indent = '  '.repeat(depth)
    console.log(`${indent}${span.agentName}:`)
    console.log(`${indent}  Input: ${span.inputMessage?.slice(0, 50)}...`)
    console.log(`${indent}  Output: ${span.outputResponse?.slice(0, 50)}...`)
    console.log(`${indent}  Events: ${span.events.length}`)
    for (const child of span.children) {
      printSpan(child, depth + 1)
    }
  }
  printSpan(result.trace.rootSpan)
}
```

## Cost by Model

Track token usage and cost broken down by model:

```typescript
const result = await agent.run(message)

if (result.trace?.costByModel) {
  for (const [modelId, usage] of Object.entries(result.trace.costByModel)) {
    console.log(`${modelId}:`)
    console.log(`  ${usage.inputTokens} input / ${usage.outputTokens} output`)
    console.log(`  ${usage.calls} API calls`)
    console.log(`  Cost: $${usage.cost.toFixed(6)}`)
    if (usage.cacheReadTokens) {
      console.log(`  ${usage.cacheReadTokens} tokens from cache`)
    }
  }
}
```

Output:

```text
claude-sonnet-4-20250514:
  2500 input / 180 output
  2 API calls
  Cost: $0.004200
claude-3-haiku-20240307:
  800 input / 45 output
  1 API calls
  Cost: $0.000300
  650 tokens from cache
```

## Custom Model Pricing

Override default pricing via `ConsoleTraceProvider`:

```typescript
import { ConsoleTraceProvider } from '@alexnetrebskii/hive-agent'

const trace = new ConsoleTraceProvider({
  showCosts: true,
  modelPricing: {
    'claude-sonnet-4-20250514': {
      inputPer1M: 3.0,        // $ per 1M input tokens
      outputPer1M: 15.0,      // $ per 1M output tokens
      cacheWritePer1M: 3.75,  // $ per 1M cache write tokens
      cacheReadPer1M: 0.30    // $ per 1M cache read tokens
    },
    'gpt-4o': {
      inputPer1M: 2.5,
      outputPer1M: 10.0
    }
  }
})
```

## Type Definitions

### Trace

```typescript
interface Trace {
  traceId: string
  rootSpan: AgentSpan
  startTime: number
  endTime?: number
  durationMs?: number
  totalCost: number
  totalInputTokens: number
  totalOutputTokens: number
  totalCacheCreationTokens: number
  totalCacheReadTokens: number
  totalLLMCalls: number
  totalToolCalls: number
  costByModel: Record<string, {
    inputTokens: number
    outputTokens: number
    cacheCreationTokens: number
    cacheReadTokens: number
    cost: number
    calls: number
  }>
}
```

### AgentSpan

```typescript
interface AgentSpan {
  type: 'agent'
  spanId: string
  parentSpanId?: string
  parent?: AgentSpan              // Reference to parent span
  agentName: string
  depth: number
  startTime: number
  endTime?: number
  durationMs?: number
  status?: 'running' | 'complete' | 'error' | 'interrupted'
  inputMessage?: string           // Input that started this agent
  outputResponse?: string         // Final response from this agent
  events: TraceEvent[]
  children: AgentSpan[]
  totalCost: number
  totalInputTokens: number
  totalOutputTokens: number
  totalCacheCreationTokens: number
  totalCacheReadTokens: number
  totalLLMCalls: number
  totalToolCalls: number
}
```

### LLMCallEvent

```typescript
interface LLMCallEvent {
  type: 'llm_call'
  spanId: string
  modelId: string
  inputTokens: number
  outputTokens: number
  cacheCreationTokens?: number
  cacheReadTokens?: number
  cost: number
  durationMs: number
  timestamp: number
  systemPrompt?: string           // System prompt sent to LLM
  messages?: Message[]            // Messages sent to LLM
  response?: ContentBlock[]       // Response content from LLM
}
```

### ToolCallEvent

```typescript
interface ToolCallEvent {
  type: 'tool_call'
  spanId: string
  toolName: string
  input: unknown
  output: ToolResult
  durationMs: number
  timestamp: number
}
```

### ModelPricing

```typescript
interface ModelPricing {
  inputPer1M: number       // $ per 1M input tokens
  outputPer1M: number      // $ per 1M output tokens
  cacheWritePer1M?: number // $ per 1M cache write tokens
  cacheReadPer1M?: number  // $ per 1M cache read tokens
}
```

## ConsoleTraceProvider Options

```typescript
interface ConsoleTraceConfig {
  showLLMCalls?: boolean      // Show LLM calls (default: true)
  showToolCalls?: boolean     // Show tool calls (default: true)
  showCosts?: boolean         // Show cost per call (default: true)
  showMessages?: boolean      // Show input/output message previews (default: true)
  maxMessageLength?: number   // Max preview length (default: 80)
  indent?: string             // Indentation string (default: '  ')
  colors?: boolean            // Use ANSI colors (default: true)
  modelPricing?: Record<string, ModelPricing>  // Custom pricing
}

const trace = new ConsoleTraceProvider({
  showCosts: true,
  showMessages: true,
  maxMessageLength: 100,
  colors: true
})
```

## Traversing Agent Hierarchy

Use the `parent` reference on `AgentSpan` to traverse up the hierarchy:

```typescript
function getAgentPath(span: AgentSpan): string {
  const names: string[] = []
  let current: AgentSpan | undefined = span
  while (current) {
    names.unshift(current.agentName)
    current = current.parent
  }
  return names.join(' → ')
}

// Example output: "main_agent → research_agent → web_search_agent"
```
