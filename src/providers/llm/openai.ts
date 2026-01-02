/**
 * OpenAI LLM Provider
 *
 * Implementation of LLMProvider for OpenAI's API (GPT-4, GPT-4o, etc.).
 */

import type {
  LLMProvider,
  LLMResponse,
  LLMOptions,
  Message,
  ToolSchema,
  ContentBlock,
  StopReason
} from '../../types.js'

export interface OpenAIProviderConfig {
  apiKey?: string
  model?: string
  maxTokens?: number
  baseURL?: string
}

interface OpenAIMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | null
  tool_calls?: OpenAIToolCall[]
  tool_call_id?: string
}

interface OpenAIToolCall {
  id: string
  type: 'function'
  function: {
    name: string
    arguments: string
  }
}

interface OpenAITool {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: Record<string, unknown>
  }
}

interface OpenAIResponse {
  id: string
  choices: Array<{
    message: {
      role: 'assistant'
      content: string | null
      tool_calls?: OpenAIToolCall[]
    }
    finish_reason: 'stop' | 'tool_calls' | 'length'
  }>
  usage: {
    prompt_tokens: number
    completion_tokens: number
    total_tokens: number
  }
}

export class OpenAIProvider implements LLMProvider {
  private apiKey: string
  private model: string
  private maxTokens: number
  private baseURL: string

  constructor(config: OpenAIProviderConfig = {}) {
    this.apiKey = config.apiKey || process.env.OPENAI_API_KEY || ''
    this.model = config.model || 'gpt-4o'
    this.maxTokens = config.maxTokens || 4096
    this.baseURL = config.baseURL || 'https://api.openai.com/v1'

    if (!this.apiKey) {
      throw new Error('OpenAI API key is required')
    }
  }

  async chat(
    systemPrompt: string,
    messages: Message[],
    tools: ToolSchema[],
    options: LLMOptions = {}
  ): Promise<LLMResponse> {
    const openaiMessages = this.convertMessages(systemPrompt, messages)
    const openaiTools = this.convertTools(tools)

    const requestBody: Record<string, unknown> = {
      model: options.model || this.model,
      max_tokens: this.maxTokens,
      messages: openaiMessages
    }

    if (openaiTools.length > 0) {
      requestBody.tools = openaiTools
    }

    const response = await fetch(`${this.baseURL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`
      },
      body: JSON.stringify(requestBody)
    })

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ error: { message: response.statusText } })) as { error?: { message?: string } }
      throw new Error(`OpenAI API error: ${errorData.error?.message || response.statusText}`)
    }

    const data = await response.json() as OpenAIResponse

    return this.convertResponse(data)
  }

  private convertMessages(systemPrompt: string, messages: Message[]): OpenAIMessage[] {
    const result: OpenAIMessage[] = [
      { role: 'system', content: systemPrompt }
    ]

    for (const msg of messages) {
      if (typeof msg.content === 'string') {
        result.push({
          role: msg.role === 'user' ? 'user' : 'assistant',
          content: msg.content
        })
      } else {
        // Handle content blocks
        const converted = this.convertContentBlocksToOpenAI(msg.content, msg.role)
        result.push(...converted)
      }
    }

    return result
  }

  private convertContentBlocksToOpenAI(blocks: ContentBlock[], role: 'user' | 'assistant'): OpenAIMessage[] {
    const messages: OpenAIMessage[] = []

    // Separate tool results from other content
    const toolResults = blocks.filter(b => b.type === 'tool_result')
    const otherBlocks = blocks.filter(b => b.type !== 'tool_result')

    // Handle assistant messages with tool_use
    if (role === 'assistant') {
      const toolUseBlocks = otherBlocks.filter(b => b.type === 'tool_use')
      const textBlocks = otherBlocks.filter(b => b.type === 'text')

      const textContent = textBlocks.map(b => (b as { text: string }).text).join('\n')

      if (toolUseBlocks.length > 0) {
        const toolCalls: OpenAIToolCall[] = toolUseBlocks.map(block => {
          const tu = block as { id: string; name: string; input: Record<string, unknown> }
          return {
            id: tu.id,
            type: 'function' as const,
            function: {
              name: tu.name,
              arguments: JSON.stringify(tu.input)
            }
          }
        })

        messages.push({
          role: 'assistant',
          content: textContent || null,
          tool_calls: toolCalls
        })
      } else if (textContent) {
        messages.push({
          role: 'assistant',
          content: textContent
        })
      }
    }

    // Handle tool results (these become separate 'tool' role messages)
    for (const tr of toolResults) {
      const toolResult = tr as { tool_use_id: string; content: string }
      messages.push({
        role: 'tool',
        content: toolResult.content,
        tool_call_id: toolResult.tool_use_id
      })
    }

    // Handle user text messages
    if (role === 'user' && toolResults.length === 0) {
      const textBlocks = otherBlocks.filter(b => b.type === 'text')
      const textContent = textBlocks.map(b => (b as { text: string }).text).join('\n')

      if (textContent) {
        messages.push({
          role: 'user',
          content: textContent
        })
      }
    }

    return messages
  }

  private convertTools(tools: ToolSchema[]): OpenAITool[] {
    return tools.map(tool => ({
      type: 'function' as const,
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.input_schema as unknown as Record<string, unknown>
      }
    }))
  }

  private convertResponse(response: OpenAIResponse): LLMResponse {
    const choice = response.choices[0]
    const content: ContentBlock[] = []

    // Add text content if present
    if (choice.message.content) {
      content.push({
        type: 'text',
        text: choice.message.content
      })
    }

    // Convert tool calls
    if (choice.message.tool_calls) {
      for (const toolCall of choice.message.tool_calls) {
        content.push({
          type: 'tool_use',
          id: toolCall.id,
          name: toolCall.function.name,
          input: JSON.parse(toolCall.function.arguments)
        })
      }
    }

    // Determine stop reason
    let stopReason: StopReason = 'end_turn'
    if (choice.finish_reason === 'tool_calls') {
      stopReason = 'tool_use'
    } else if (choice.finish_reason === 'length') {
      stopReason = 'max_tokens'
    }

    return {
      content,
      stopReason,
      usage: {
        inputTokens: response.usage.prompt_tokens,
        outputTokens: response.usage.completion_tokens
      }
    }
  }

  getModelId(): string {
    return `openai:${this.model}`
  }
}
