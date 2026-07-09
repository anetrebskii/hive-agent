/**
 * Trace Pricing - Model pricing data and cost calculation
 */

import type { ModelPricing } from './types.js'
import { OPENROUTER_MODEL_PRICING } from './openrouter-pricing.js'

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
  // Google Gemini models (direct API, OpenAI-compatible endpoint; base tier list prices)
  'google:gemini-2.5-pro': { inputPer1M: 1.25, outputPer1M: 10.00, cacheReadPer1M: 0.31 },
  'google:gemini-2.5-flash': { inputPer1M: 0.30, outputPer1M: 2.50, cacheReadPer1M: 0.075 },
  'google:gemini-2.5-flash-lite': { inputPer1M: 0.10, outputPer1M: 0.40, cacheReadPer1M: 0.025 },
  'google:gemini-2.0-flash': { inputPer1M: 0.10, outputPer1M: 0.40, cacheReadPer1M: 0.025 },
  'google:gemini-2.0-flash-lite': { inputPer1M: 0.075, outputPer1M: 0.30 },
  'google:gemini-1.5-pro': { inputPer1M: 1.25, outputPer1M: 5.00, cacheReadPer1M: 0.3125 },
  'google:gemini-1.5-flash': { inputPer1M: 0.075, outputPer1M: 0.30, cacheReadPer1M: 0.01875 },
  'google:gemini-1.5-flash-8b': { inputPer1M: 0.0375, outputPer1M: 0.15, cacheReadPer1M: 0.01 },
  // OpenRouter models (auto-generated, see openrouter-pricing.ts)
  ...OPENROUTER_MODEL_PRICING,
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
