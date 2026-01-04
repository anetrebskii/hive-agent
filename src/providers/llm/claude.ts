/**
 * Claude LLM Provider
 *
 * Implementation of LLMProvider for Anthropic's Claude API.
 */

import Anthropic from '@anthropic-ai/sdk'
import type {
  LLMProvider,
  LLMResponse,
  LLMOptions,
  Message,
  ToolSchema,
  ContentBlock,
  StopReason
} from '../../types.js'

export interface ClaudeProviderConfig {
  apiKey?: string
  model?: string
  maxTokens?: number
  /** Enable prompt caching to reduce costs */
  cache?: boolean
}

export class ClaudeProvider implements LLMProvider {
  private client: Anthropic
  private model: string
  private maxTokens: number
  private cache: boolean

  constructor(config: ClaudeProviderConfig = {}) {
    this.client = new Anthropic({
      apiKey: config.apiKey
    })
    this.model = config.model || 'claude-sonnet-4-20250514'
    this.maxTokens = config.maxTokens || 8192
    this.cache = config.cache ?? false
  }

  async chat(
    systemPrompt: string,
    messages: Message[],
    tools: ToolSchema[],
    options: LLMOptions = {}
  ): Promise<LLMResponse> {
    const anthropicMessages = this.convertMessages(messages, this.cache)
    const anthropicTools = this.convertTools(tools, this.cache)
    const systemContent = this.buildSystemContent(systemPrompt, this.cache)

    const requestParams: Anthropic.MessageCreateParams = {
      model: options.model || this.model,
      max_tokens: this.maxTokens,
      system: systemContent,
      messages: anthropicMessages,
      tools: anthropicTools.length > 0 ? anthropicTools : undefined
    }

    const response = await this.client.messages.create(requestParams)

    return this.convertResponse(response)
  }

  /**
   * Build system content with optional caching
   */
  private buildSystemContent(
    systemPrompt: string,
    enableCache: boolean
  ): string | Anthropic.TextBlockParam[] {
    if (!enableCache) {
      return systemPrompt
    }

    return [{
      type: 'text' as const,
      text: systemPrompt,
      cache_control: { type: 'ephemeral' as const }
    }]
  }

  private convertMessages(messages: Message[], enableCache: boolean = false): Anthropic.MessageParam[] {
    // Find the last user message index for cache breakpoint
    const lastUserIndex = this.findLastUserMessageIndex(messages)

    return messages.map((msg, index) => {
      const shouldCache = enableCache && index === lastUserIndex

      if (typeof msg.content === 'string') {
        if (shouldCache) {
          return {
            role: msg.role,
            content: [{
              type: 'text' as const,
              text: msg.content,
              cache_control: { type: 'ephemeral' as const }
            }]
          }
        }
        return { role: msg.role, content: msg.content }
      }

      const blocks = this.convertContentBlocks(msg.content)

      if (shouldCache && blocks.length > 0) {
        // Add cache_control to the last block
        const lastBlock = blocks[blocks.length - 1]
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ;(lastBlock as any).cache_control = { type: 'ephemeral' }
      }

      return { role: msg.role, content: blocks }
    })
  }

  /**
   * Find the last user message index (for cache breakpoint)
   */
  private findLastUserMessageIndex(messages: Message[]): number {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'user') {
        return i
      }
    }
    return -1
  }

  private convertContentBlocks(blocks: ContentBlock[]): Anthropic.ContentBlockParam[] {
    return blocks.map(block => {
      switch (block.type) {
        case 'text':
          return { type: 'text' as const, text: block.text }
        case 'tool_use':
          return {
            type: 'tool_use' as const,
            id: block.id,
            name: block.name,
            input: block.input
          }
        case 'tool_result':
          return {
            type: 'tool_result' as const,
            tool_use_id: block.tool_use_id,
            content: block.content,
            is_error: block.is_error
          }
        case 'thinking':
          return { type: 'thinking' as const, thinking: block.thinking }
        default:
          throw new Error(`Unknown content block type: ${(block as ContentBlock).type}`)
      }
    }) as Anthropic.ContentBlockParam[]
  }

  private convertTools(tools: ToolSchema[], enableCache: boolean = false): Anthropic.Tool[] {
    return tools.map((tool, index) => {
      const isLast = index === tools.length - 1
      const baseTool = {
        name: tool.name,
        description: tool.description,
        input_schema: tool.input_schema as Anthropic.Tool.InputSchema
      }

      if (enableCache && isLast) {
        return {
          ...baseTool,
          cache_control: { type: 'ephemeral' as const }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any
      }

      return baseTool
    })
  }

  private convertResponse(response: Anthropic.Message): LLMResponse {
    const content: ContentBlock[] = response.content.map(block => {
      switch (block.type) {
        case 'text':
          return { type: 'text' as const, text: block.text }
        case 'tool_use':
          return {
            type: 'tool_use' as const,
            id: block.id,
            name: block.name,
            input: block.input as Record<string, unknown>
          }
        default:
          // Handle thinking blocks and other types
          if ('thinking' in block) {
            return { type: 'thinking' as const, thinking: (block as { thinking: string }).thinking }
          }
          return { type: 'text' as const, text: '' }
      }
    })

    const stopReason: StopReason =
      response.stop_reason === 'tool_use' ? 'tool_use' :
      response.stop_reason === 'max_tokens' ? 'max_tokens' :
      'end_turn'

    // Extract cache usage from response
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const usage = response.usage as any
    const cacheUsage = (usage.cache_creation_input_tokens || usage.cache_read_input_tokens)
      ? {
          cacheCreationInputTokens: usage.cache_creation_input_tokens || 0,
          cacheReadInputTokens: usage.cache_read_input_tokens || 0
        }
      : undefined

    return {
      content,
      stopReason,
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens
      },
      cacheUsage
    }
  }

  getModelId(): string {
    return `claude:${this.model}`
  }
}
