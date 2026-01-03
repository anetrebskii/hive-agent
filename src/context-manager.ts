/**
 * Context Management
 *
 * Token estimation and context management utilities.
 */

import type { Message, ContentBlock, ContextStrategy } from './types.js'

/**
 * Estimate token count from text (approximately 4 chars per token)
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

/**
 * Estimate tokens for a message
 */
export function estimateMessageTokens(message: Message): number {
  if (typeof message.content === 'string') {
    return estimateTokens(message.content)
  }

  return message.content.reduce((sum, block) => {
    return sum + estimateContentBlockTokens(block)
  }, 0)
}

/**
 * Estimate tokens for a content block
 */
export function estimateContentBlockTokens(block: ContentBlock): number {
  switch (block.type) {
    case 'text':
      return estimateTokens(block.text)
    case 'thinking':
      return estimateTokens(block.thinking)
    case 'tool_use':
      return estimateTokens(block.name) + estimateTokens(JSON.stringify(block.input))
    case 'tool_result':
      return estimateTokens(block.content)
    default:
      return 0
  }
}

/**
 * Estimate total tokens for all messages
 */
export function estimateTotalTokens(messages: Message[]): number {
  return messages.reduce((sum, msg) => sum + estimateMessageTokens(msg), 0)
}

/**
 * Truncate old messages to fit within token limit
 */
export function truncateOldMessages(
  messages: Message[],
  maxTokens: number,
  preserveFirst: number = 1
): Message[] {
  if (messages.length <= preserveFirst) {
    return messages
  }

  const result: Message[] = []
  let totalTokens = 0

  // Always preserve first N messages (usually system context)
  for (let i = 0; i < preserveFirst && i < messages.length; i++) {
    result.push(messages[i])
    totalTokens += estimateMessageTokens(messages[i])
  }

  // Add messages from the end until we hit the limit
  const remaining: Message[] = []
  for (let i = messages.length - 1; i >= preserveFirst; i--) {
    const msgTokens = estimateMessageTokens(messages[i])
    if (totalTokens + msgTokens <= maxTokens) {
      remaining.unshift(messages[i])
      totalTokens += msgTokens
    } else {
      break
    }
  }

  return [...result, ...remaining]
}

/**
 * Context manager for tracking token usage during execution
 */
export class ContextManager {
  private maxTokens: number
  private strategy: ContextStrategy
  private currentTokens: number = 0

  constructor(maxTokens: number = 100000, strategy: ContextStrategy = 'truncate_old') {
    this.maxTokens = maxTokens
    this.strategy = strategy
  }

  /**
   * Update current token count
   */
  updateTokenCount(messages: Message[]): void {
    this.currentTokens = estimateTotalTokens(messages)
  }

  /**
   * Get remaining tokens available
   */
  getRemainingTokens(): number {
    return Math.max(0, this.maxTokens - this.currentTokens)
  }

  /**
   * Check if context is within limits
   */
  isWithinLimits(): boolean {
    return this.currentTokens <= this.maxTokens
  }

  /**
   * Manage context according to strategy
   */
  manageContext(messages: Message[]): Message[] {
    this.updateTokenCount(messages)

    if (this.isWithinLimits()) {
      return messages
    }

    switch (this.strategy) {
      case 'truncate_old':
        return truncateOldMessages(messages, this.maxTokens)
      case 'summarize':
        // Summarization would require LLM call - for now, fall back to truncation
        return truncateOldMessages(messages, this.maxTokens)
      case 'error':
        throw new Error(`Context limit exceeded: ${this.currentTokens} > ${this.maxTokens} tokens`)
      default:
        return messages
    }
  }
}
