/**
 * Trace Module - Execution tracing and cost tracking
 */

// Types
export type {
  TraceId,
  SpanId,
  ModelPricing,
  LLMCallEvent,
  ToolCallEvent,
  TraceEvent,
  AgentSpan,
  Trace,
  TraceContext,
  TraceProvider
} from './types.js'

export { generateTraceId, generateSpanId } from './types.js'

// Pricing
export { DEFAULT_MODEL_PRICING, calculateCost } from './pricing.js'

// Builder
export { TraceBuilder } from './builder.js'

// Console Provider
export type { ConsoleTraceConfig } from './console.js'
export { ConsoleTraceProvider } from './console.js'
