/**
 * Trace Provider - Execution Tracing and Cost Tracking
 *
 * Provides full visibility into agent execution hierarchy including:
 * - LLM calls with token usage and cost
 * - Tool calls with duration
 * - Sub-agent execution (nested)
 * - Complete cost breakdown by model
 */

import type { ToolResult } from './types.js'

// ============================================================================
// Trace Types
// ============================================================================

/**
 * Unique identifier for a trace run
 */
export type TraceId = string

/**
 * Unique identifier for a span within a trace
 */
export type SpanId = string

/**
 * Generate a unique trace ID
 */
export function generateTraceId(): TraceId {
  return `trace_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
}

/**
 * Generate a unique span ID
 */
export function generateSpanId(): SpanId {
  return `span_${Math.random().toString(36).slice(2, 11)}`
}

/**
 * Model pricing per 1M tokens (input/output)
 */
export interface ModelPricing {
  inputPer1M: number
  outputPer1M: number
  cacheWritePer1M?: number
  cacheReadPer1M?: number
}

/**
 * Default pricing for common models
 */
export const DEFAULT_MODEL_PRICING: Record<string, ModelPricing> = {
  // Claude models
  'claude:claude-3-haiku-20240307': { inputPer1M: 0.25, outputPer1M: 1.25, cacheWritePer1M: 0.30, cacheReadPer1M: 0.03 },
  'claude:claude-3-5-haiku-20241022': { inputPer1M: 0.80, outputPer1M: 4.00, cacheWritePer1M: 1.00, cacheReadPer1M: 0.08 },
  'claude:claude-3-5-sonnet-20241022': { inputPer1M: 3.00, outputPer1M: 15.00, cacheWritePer1M: 3.75, cacheReadPer1M: 0.30 },
  'claude:claude-sonnet-4-20250514': { inputPer1M: 3.00, outputPer1M: 15.00, cacheWritePer1M: 3.75, cacheReadPer1M: 0.30 },
  'claude:claude-opus-4-20250514': { inputPer1M: 15.00, outputPer1M: 75.00, cacheWritePer1M: 18.75, cacheReadPer1M: 1.50 },
  // OpenAI models
  'openai:gpt-4o': { inputPer1M: 2.50, outputPer1M: 10.00 },
  'openai:gpt-4o-mini': { inputPer1M: 0.15, outputPer1M: 0.60 },
  'openai:gpt-4-turbo': { inputPer1M: 10.00, outputPer1M: 30.00 },
}

/**
 * Calculate cost for a model call
 */
export function calculateCost(
  modelId: string,
  inputTokens: number,
  outputTokens: number,
  cacheCreationTokens?: number,
  cacheReadTokens?: number,
  customPricing?: Record<string, ModelPricing>
): number {
  const pricing = customPricing?.[modelId] || DEFAULT_MODEL_PRICING[modelId]
  if (!pricing) {
    return 0 // Unknown model
  }

  let cost = 0
  cost += (inputTokens / 1_000_000) * pricing.inputPer1M
  cost += (outputTokens / 1_000_000) * pricing.outputPer1M

  if (cacheCreationTokens && pricing.cacheWritePer1M) {
    cost += (cacheCreationTokens / 1_000_000) * pricing.cacheWritePer1M
  }
  if (cacheReadTokens && pricing.cacheReadPer1M) {
    cost += (cacheReadTokens / 1_000_000) * pricing.cacheReadPer1M
  }

  return cost
}

/**
 * LLM call event data
 */
export interface LLMCallEvent {
  type: 'llm_call'
  spanId: SpanId
  modelId: string
  inputTokens: number
  outputTokens: number
  cacheCreationTokens?: number
  cacheReadTokens?: number
  cost: number
  durationMs: number
  timestamp: number
}

/**
 * Tool call event data
 */
export interface ToolCallEvent {
  type: 'tool_call'
  spanId: SpanId
  toolName: string
  input: unknown
  output: ToolResult
  durationMs: number
  timestamp: number
}

/**
 * Agent span - represents an agent's execution
 */
export interface AgentSpan {
  type: 'agent'
  spanId: SpanId
  parentSpanId?: SpanId
  agentName: string
  depth: number
  startTime: number
  endTime?: number
  durationMs?: number
  status?: 'running' | 'complete' | 'error' | 'interrupted'
  events: TraceEvent[]
  children: AgentSpan[]
  // Aggregated metrics
  totalCost: number
  totalInputTokens: number
  totalOutputTokens: number
  totalCacheCreationTokens: number
  totalCacheReadTokens: number
  totalLLMCalls: number
  totalToolCalls: number
}

/**
 * Any trace event
 */
export type TraceEvent = LLMCallEvent | ToolCallEvent

/**
 * Complete trace of an agent run
 */
export interface Trace {
  traceId: TraceId
  rootSpan: AgentSpan
  startTime: number
  endTime?: number
  durationMs?: number
  // Total aggregated metrics
  totalCost: number
  totalInputTokens: number
  totalOutputTokens: number
  totalCacheCreationTokens: number
  totalCacheReadTokens: number
  totalLLMCalls: number
  totalToolCalls: number
  // Breakdown by model
  costByModel: Record<string, {
    inputTokens: number
    outputTokens: number
    cacheCreationTokens: number
    cacheReadTokens: number
    cost: number
    calls: number
  }>
}

// ============================================================================
// Trace Context
// ============================================================================

/**
 * Context passed during execution for tracing
 */
export interface TraceContext {
  traceId: TraceId
  currentSpan: AgentSpan
  provider: TraceProvider
  pricing?: Record<string, ModelPricing>
}

// ============================================================================
// Trace Provider Interface
// ============================================================================

/**
 * Interface for trace providers
 * Implement this to create custom trace logging (console, file, remote service, etc.)
 */
export interface TraceProvider {
  /**
   * Called when a new trace starts (top-level agent run)
   */
  onTraceStart(trace: Trace): void

  /**
   * Called when a trace ends
   */
  onTraceEnd(trace: Trace): void

  /**
   * Called when an agent span starts
   */
  onAgentStart(span: AgentSpan, trace: Trace): void

  /**
   * Called when an agent span ends
   */
  onAgentEnd(span: AgentSpan, trace: Trace): void

  /**
   * Called for each LLM call
   */
  onLLMCall(event: LLMCallEvent, span: AgentSpan, trace: Trace): void

  /**
   * Called for each tool call
   */
  onToolCall(event: ToolCallEvent, span: AgentSpan, trace: Trace): void
}

// ============================================================================
// Trace Builder
// ============================================================================

/**
 * Builder for constructing traces during execution
 */
export class TraceBuilder {
  private trace: Trace
  private spanStack: AgentSpan[] = []
  private provider?: TraceProvider
  private pricing?: Record<string, ModelPricing>

  constructor(
    agentName: string,
    provider?: TraceProvider,
    pricing?: Record<string, ModelPricing>
  ) {
    this.provider = provider
    this.pricing = pricing

    const traceId = generateTraceId()
    const rootSpan: AgentSpan = {
      type: 'agent',
      spanId: generateSpanId(),
      agentName,
      depth: 0,
      startTime: Date.now(),
      events: [],
      children: [],
      totalCost: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalCacheCreationTokens: 0,
      totalCacheReadTokens: 0,
      totalLLMCalls: 0,
      totalToolCalls: 0
    }

    this.trace = {
      traceId,
      rootSpan,
      startTime: Date.now(),
      totalCost: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalCacheCreationTokens: 0,
      totalCacheReadTokens: 0,
      totalLLMCalls: 0,
      totalToolCalls: 0,
      costByModel: {}
    }

    this.spanStack.push(rootSpan)
    this.provider?.onTraceStart(this.trace)
    this.provider?.onAgentStart(rootSpan, this.trace)
  }

  /**
   * Get the current trace context
   */
  getContext(): TraceContext {
    return {
      traceId: this.trace.traceId,
      currentSpan: this.getCurrentSpan(),
      provider: this.provider!,
      pricing: this.pricing
    }
  }

  /**
   * Get the current span
   */
  getCurrentSpan(): AgentSpan {
    return this.spanStack[this.spanStack.length - 1]
  }

  /**
   * Start a sub-agent span
   */
  startSubAgent(agentName: string): AgentSpan {
    const parentSpan = this.getCurrentSpan()
    const span: AgentSpan = {
      type: 'agent',
      spanId: generateSpanId(),
      parentSpanId: parentSpan.spanId,
      agentName,
      depth: parentSpan.depth + 1,
      startTime: Date.now(),
      status: 'running',
      events: [],
      children: [],
      totalCost: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalCacheCreationTokens: 0,
      totalCacheReadTokens: 0,
      totalLLMCalls: 0,
      totalToolCalls: 0
    }

    parentSpan.children.push(span)
    this.spanStack.push(span)
    this.provider?.onAgentStart(span, this.trace)

    return span
  }

  /**
   * End the current sub-agent span
   */
  endSubAgent(status: 'complete' | 'error' | 'interrupted' = 'complete'): void {
    if (this.spanStack.length <= 1) {
      return // Don't pop the root span
    }

    const span = this.spanStack.pop()!
    span.endTime = Date.now()
    span.durationMs = span.endTime - span.startTime
    span.status = status

    // Propagate metrics to parent
    const parentSpan = this.getCurrentSpan()
    parentSpan.totalCost += span.totalCost
    parentSpan.totalInputTokens += span.totalInputTokens
    parentSpan.totalOutputTokens += span.totalOutputTokens
    parentSpan.totalCacheCreationTokens += span.totalCacheCreationTokens
    parentSpan.totalCacheReadTokens += span.totalCacheReadTokens
    parentSpan.totalLLMCalls += span.totalLLMCalls
    parentSpan.totalToolCalls += span.totalToolCalls

    this.provider?.onAgentEnd(span, this.trace)
  }

  /**
   * Record an LLM call
   */
  recordLLMCall(
    modelId: string,
    inputTokens: number,
    outputTokens: number,
    durationMs: number,
    cacheCreationTokens?: number,
    cacheReadTokens?: number
  ): void {
    const cost = calculateCost(
      modelId,
      inputTokens,
      outputTokens,
      cacheCreationTokens,
      cacheReadTokens,
      this.pricing
    )

    const event: LLMCallEvent = {
      type: 'llm_call',
      spanId: generateSpanId(),
      modelId,
      inputTokens,
      outputTokens,
      cacheCreationTokens,
      cacheReadTokens,
      cost,
      durationMs,
      timestamp: Date.now()
    }

    const span = this.getCurrentSpan()
    span.events.push(event)
    span.totalCost += cost
    span.totalInputTokens += inputTokens
    span.totalOutputTokens += outputTokens
    span.totalCacheCreationTokens += cacheCreationTokens || 0
    span.totalCacheReadTokens += cacheReadTokens || 0
    span.totalLLMCalls += 1

    // Update trace-level metrics
    this.trace.totalCost += cost
    this.trace.totalInputTokens += inputTokens
    this.trace.totalOutputTokens += outputTokens
    this.trace.totalCacheCreationTokens += cacheCreationTokens || 0
    this.trace.totalCacheReadTokens += cacheReadTokens || 0
    this.trace.totalLLMCalls += 1

    // Update cost by model
    if (!this.trace.costByModel[modelId]) {
      this.trace.costByModel[modelId] = {
        inputTokens: 0,
        outputTokens: 0,
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
        cost: 0,
        calls: 0
      }
    }
    this.trace.costByModel[modelId].inputTokens += inputTokens
    this.trace.costByModel[modelId].outputTokens += outputTokens
    this.trace.costByModel[modelId].cacheCreationTokens += cacheCreationTokens || 0
    this.trace.costByModel[modelId].cacheReadTokens += cacheReadTokens || 0
    this.trace.costByModel[modelId].cost += cost
    this.trace.costByModel[modelId].calls += 1

    this.provider?.onLLMCall(event, span, this.trace)
  }

  /**
   * Record a tool call
   */
  recordToolCall(
    toolName: string,
    input: unknown,
    output: ToolResult,
    durationMs: number
  ): void {
    const event: ToolCallEvent = {
      type: 'tool_call',
      spanId: generateSpanId(),
      toolName,
      input,
      output,
      durationMs,
      timestamp: Date.now()
    }

    const span = this.getCurrentSpan()
    span.events.push(event)
    span.totalToolCalls += 1
    this.trace.totalToolCalls += 1

    this.provider?.onToolCall(event, span, this.trace)
  }

  /**
   * End the trace
   */
  endTrace(status: 'complete' | 'error' | 'interrupted' = 'complete'): Trace {
    const rootSpan = this.trace.rootSpan
    rootSpan.endTime = Date.now()
    rootSpan.durationMs = rootSpan.endTime - rootSpan.startTime
    rootSpan.status = status

    this.trace.endTime = Date.now()
    this.trace.durationMs = this.trace.endTime - this.trace.startTime

    this.provider?.onAgentEnd(rootSpan, this.trace)
    this.provider?.onTraceEnd(this.trace)

    return this.trace
  }

  /**
   * Get the current trace
   */
  getTrace(): Trace {
    return this.trace
  }
}

// ============================================================================
// Console Trace Provider
// ============================================================================

export interface ConsoleTraceConfig {
  /** Show LLM calls */
  showLLMCalls?: boolean
  /** Show tool calls */
  showToolCalls?: boolean
  /** Show cost breakdown */
  showCosts?: boolean
  /** Indentation string */
  indent?: string
  /** Use colors (ANSI) */
  colors?: boolean
}

/**
 * Console trace provider - logs trace events to console
 */
export class ConsoleTraceProvider implements TraceProvider {
  private config: Required<ConsoleTraceConfig>

  constructor(config: ConsoleTraceConfig = {}) {
    this.config = {
      showLLMCalls: config.showLLMCalls ?? true,
      showToolCalls: config.showToolCalls ?? true,
      showCosts: config.showCosts ?? true,
      indent: config.indent ?? '  ',
      colors: config.colors ?? true
    }
  }

  private getIndent(depth: number): string {
    return this.config.indent.repeat(depth)
  }

  private formatCost(cost: number): string {
    return `$${cost.toFixed(6)}`
  }

  private color(text: string, code: string): string {
    if (!this.config.colors) return text
    return `\x1b[${code}m${text}\x1b[0m`
  }

  onTraceStart(trace: Trace): void {
    console.log(this.color(`\n━━━ Trace: ${trace.traceId} ━━━`, '1;36'))
  }

  onTraceEnd(trace: Trace): void {
    console.log(this.color(`\n━━━ Trace Complete ━━━`, '1;36'))
    console.log(`Duration: ${trace.durationMs}ms`)
    console.log(`Total LLM calls: ${trace.totalLLMCalls}`)
    console.log(`Total tool calls: ${trace.totalToolCalls}`)

    // Show tokens with cache breakdown
    let tokenLine = `Total tokens: ${trace.totalInputTokens} in / ${trace.totalOutputTokens} out`
    if (trace.totalCacheCreationTokens || trace.totalCacheReadTokens) {
      tokenLine += ` [cache: +${trace.totalCacheCreationTokens} write, ${trace.totalCacheReadTokens} read]`
    }
    console.log(tokenLine)

    if (this.config.showCosts) {
      console.log(this.color(`Total cost: ${this.formatCost(trace.totalCost)}`, '1;33'))

      if (Object.keys(trace.costByModel).length > 1) {
        console.log('\nCost by model:')
        for (const [modelId, data] of Object.entries(trace.costByModel)) {
          let line = `  ${modelId}: ${this.formatCost(data.cost)} (${data.calls} calls, ${data.inputTokens}/${data.outputTokens} tokens`
          if (data.cacheReadTokens) {
            line += `, ${data.cacheReadTokens} cached`
          }
          line += ')'
          console.log(line)
        }
      }
    }
    console.log('')
  }

  onAgentStart(span: AgentSpan, _trace: Trace): void {
    const indent = this.getIndent(span.depth)
    const icon = span.depth === 0 ? '🤖' : '🔹'
    console.log(`${indent}${icon} ${this.color(span.agentName, '1;32')} started`)
  }

  onAgentEnd(span: AgentSpan, _trace: Trace): void {
    const indent = this.getIndent(span.depth)
    const status = span.status === 'complete' ? '✓' :
                   span.status === 'error' ? '✗' : '⚠'
    const statusColor = span.status === 'complete' ? '32' :
                        span.status === 'error' ? '31' : '33'

    let line = `${indent}${this.color(status, statusColor)} ${span.agentName} completed`
    line += ` (${span.durationMs}ms`

    if (this.config.showCosts && span.totalCost > 0) {
      line += `, ${this.formatCost(span.totalCost)}`
    }
    line += ')'

    console.log(line)
  }

  onLLMCall(event: LLMCallEvent, span: AgentSpan, _trace: Trace): void {
    if (!this.config.showLLMCalls) return

    const indent = this.getIndent(span.depth + 1)
    let line = `${indent}${this.color('⚡', '33')} LLM: ${event.modelId}`
    line += ` (${event.inputTokens}/${event.outputTokens} tokens`
    if (event.cacheReadTokens) {
      line += ` +${event.cacheReadTokens} cached`
    }
    line += `, ${event.durationMs}ms`

    if (this.config.showCosts) {
      line += `, ${this.formatCost(event.cost)}`
    }
    line += ')'

    console.log(line)
  }

  onToolCall(event: ToolCallEvent, span: AgentSpan, _trace: Trace): void {
    if (!this.config.showToolCalls) return

    const indent = this.getIndent(span.depth + 1)
    const status = event.output.success ? this.color('✓', '32') : this.color('✗', '31')
    console.log(`${indent}${this.color('🔧', '35')} ${event.toolName} ${status} (${event.durationMs}ms)`)
  }
}
