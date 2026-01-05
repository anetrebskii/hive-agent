/**
 * Trace Builder - Constructs traces during agent execution
 */

import type { ToolResult } from '../types.js'
import type {
  Trace,
  TraceContext,
  TraceProvider,
  AgentSpan,
  LLMCallEvent,
  ToolCallEvent,
  ModelPricing
} from './types.js'
import { generateTraceId, generateSpanId } from './types.js'
import { calculateCost } from './pricing.js'

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
    provider?: TraceProvider
  ) {
    this.provider = provider
    this.pricing = provider?.modelPricing

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
