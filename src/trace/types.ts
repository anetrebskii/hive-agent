/**
 * Trace Types - Type definitions for execution tracing
 */

import type { ToolResult } from '../types.js'

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
  /** System prompt sent to LLM */
  systemPrompt?: string
  /** Messages sent to LLM */
  messages?: import('../types.js').Message[]
  /** Response content from LLM */
  response?: import('../types.js').ContentBlock[]
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
 * Any trace event
 */
export type TraceEvent = LLMCallEvent | ToolCallEvent

/**
 * Agent span - represents an agent's execution
 */
export interface AgentSpan {
  type: 'agent'
  spanId: SpanId
  parentSpanId?: SpanId
  /** Reference to parent span for hierarchy traversal */
  parent?: AgentSpan
  agentName: string
  depth: number
  startTime: number
  endTime?: number
  durationMs?: number
  status?: 'running' | 'complete' | 'error' | 'interrupted'
  /** Input message that started this agent */
  inputMessage?: string
  /** Final response from this agent */
  outputResponse?: string
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

/**
 * Context passed during execution for tracing
 */
export interface TraceContext {
  traceId: TraceId
  currentSpan: AgentSpan
  provider: TraceProvider
  pricing?: Record<string, ModelPricing>
}

/**
 * Interface for trace providers
 */
export interface TraceProvider {
  onTraceStart(trace: Trace): void
  onTraceEnd(trace: Trace): void
  onAgentStart(span: AgentSpan, trace: Trace): void
  onAgentEnd(span: AgentSpan, trace: Trace): void
  onLLMCall(event: LLMCallEvent, span: AgentSpan, trace: Trace): void
  onToolCall(event: ToolCallEvent, span: AgentSpan, trace: Trace): void
  modelPricing?: Record<string, ModelPricing>
}
