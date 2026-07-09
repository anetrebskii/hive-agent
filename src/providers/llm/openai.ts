/**
 * OpenAI LLM Provider
 *
 * Implementation of LLMProvider for OpenAI's chat-completions API and any
 * OpenAI-compatible vendor (Groq, Together, Fireworks, DeepSeek, xAI, etc.).
 * Vendor presets at the bottom of the file fill in the right `baseURL`,
 * env-var fallback, and `vendor` namespace for cost / trace attribution.
 */

import type {
  LLMProvider,
  LLMResponse,
  LLMOptions,
  Message,
  ToolSchema,
  ContentBlock,
  StopReason,
  CacheUsage
} from '../../types.js'

import { defaultSanitize } from '../../sanitize.js'

export interface OpenAIProviderConfig {
  apiKey?: string
  model?: string
  maxTokens?: number
  baseURL?: string
  /**
   * Namespace returned by `getModelId()` (e.g. `groq`, `deepseek`, `xai`).
   * Default `openai`. Cost-pricing tables and trace events key off this.
   */
  vendor?: string
  /**
   * Strip reasoning-channel artifacts (`<|channel|>` markers, leading
   * `thought\n` / `analysis\n` preambles) from `text` content blocks.
   * Default `true`. Set to `false` to render the reasoning stream yourself.
   */
  stripReasoning?: boolean
  /**
   * Extra headers merged into every request — for vendors that require a
   * custom header (e.g. Anthropic-style versioning, Together's
   * `HTTP-Referer`, etc.).
   */
  defaultHeaders?: Record<string, string>
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
    prompt_tokens_details?: {
      cached_tokens?: number
      cache_write_tokens?: number
    }
  }
}

export class OpenAIProvider implements LLMProvider {
  readonly supportsNativeTools = true
  private apiKey: string
  private model: string
  private maxTokens: number
  private baseURL: string
  private vendor: string
  private stripReasoning: boolean
  private defaultHeaders: Record<string, string>

  constructor(config: OpenAIProviderConfig = {}) {
    this.apiKey = config.apiKey || process.env.OPENAI_API_KEY || ''
    this.model = config.model || 'gpt-4o'
    this.maxTokens = config.maxTokens || 4096
    this.baseURL = config.baseURL || 'https://api.openai.com/v1'
    this.vendor = config.vendor || 'openai'
    this.stripReasoning = config.stripReasoning !== false
    this.defaultHeaders = config.defaultHeaders ?? {}

    if (!this.apiKey) {
      throw new Error(`${this.vendor} API key is required`)
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

    if (options.temperature !== undefined) {
      requestBody.temperature = options.temperature
    }
    if (options.topP !== undefined) {
      requestBody.top_p = options.topP
    }
    if (options.stopSequences && options.stopSequences.length > 0) {
      requestBody.stop = options.stopSequences
    }

    const response = await fetch(`${this.baseURL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
        ...this.defaultHeaders
      },
      body: JSON.stringify(requestBody)
    })

    const rawBody = await response.text()
    const data = safeParseJson(rawBody) as
      | (OpenAIResponse & { error?: { message?: string } })
      | null

    if (!response.ok) {
      const upstream = data?.error?.message || response.statusText
      throw new Error(
        `${this.vendor} API error (HTTP ${response.status}): ${upstream}`
      )
    }

    if (!data) {
      throw new Error(
        `${this.vendor} API error: response was not valid JSON — body: ${truncate(rawBody, 500)}`
      )
    }

    if (data.error) {
      throw new Error(
        `${this.vendor} API error: ${data.error.message || 'provider returned an error'}`
      )
    }

    if (!data.choices?.[0]?.message) {
      throw new Error(
        `${this.vendor} API error: empty response (no choices returned) — body: ${truncate(rawBody, 500)}`
      )
    }

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
        const converted = this.convertContentBlocksToOpenAI(msg.content, msg.role)
        result.push(...converted)
      }
    }

    return result
  }

  private convertContentBlocksToOpenAI(blocks: ContentBlock[], role: 'user' | 'assistant'): OpenAIMessage[] {
    const messages: OpenAIMessage[] = []

    const toolResults = blocks.filter(b => b.type === 'tool_result')
    const otherBlocks = blocks.filter(b => b.type !== 'tool_result')

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

    for (const tr of toolResults) {
      const toolResult = tr as { tool_use_id: string; content: string }
      messages.push({
        role: 'tool',
        content: toolResult.content,
        tool_call_id: toolResult.tool_use_id
      })
    }

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

    if (choice.message.content) {
      const cleaned = this.stripReasoning
        ? defaultSanitize(choice.message.content)
        : choice.message.content
      if (cleaned.length > 0) {
        content.push({ type: 'text', text: cleaned })
      }
    }

    if (choice.message.tool_calls) {
      for (const toolCall of choice.message.tool_calls) {
        content.push({
          type: 'tool_use',
          id: toolCall.id,
          name: toolCall.function.name,
          input: toolCall.function.arguments ? JSON.parse(toolCall.function.arguments) : {}
        })
      }
    }

    let stopReason: StopReason = 'end_turn'
    if (choice.finish_reason === 'tool_calls') {
      stopReason = 'tool_use'
    } else if (choice.finish_reason === 'length') {
      stopReason = 'max_tokens'
    }

    const details = response.usage.prompt_tokens_details
    const cachedRead = details?.cached_tokens || 0
    const cacheWrite = details?.cache_write_tokens || 0
    let cacheUsage: CacheUsage | undefined
    if (cachedRead || cacheWrite) {
      cacheUsage = {
        cacheReadInputTokens: cachedRead,
        cacheCreationInputTokens: cacheWrite
      }
    }

    // Match OpenRouter's convention: inputTokens excludes cached tokens, so
    // cost calculation prices cache reads at the cache-read rate instead of
    // double-counting them at the regular input rate.
    const inputTokens = response.usage.prompt_tokens - cachedRead - cacheWrite

    return {
      content,
      stopReason,
      usage: {
        inputTokens,
        outputTokens: response.usage.completion_tokens
      },
      cacheUsage
    }
  }

  getModelId(): string {
    return `${this.vendor}:${this.model}`
  }

  // ---------- Vendor presets ----------------------------------------------
  // Thin factories that fill in baseURL + vendor namespace + env-var fallback
  // so callers don't have to hand-type the right URL for each compatible vendor.

  static groq(config: OpenAIProviderConfig = {}): OpenAIProvider {
    return new OpenAIProvider({
      ...config,
      apiKey: config.apiKey || process.env.GROQ_API_KEY,
      baseURL: config.baseURL || 'https://api.groq.com/openai/v1',
      vendor: config.vendor || 'groq',
      model: config.model || 'llama-3.3-70b-versatile'
    })
  }

  static together(config: OpenAIProviderConfig = {}): OpenAIProvider {
    return new OpenAIProvider({
      ...config,
      apiKey: config.apiKey || process.env.TOGETHER_API_KEY,
      baseURL: config.baseURL || 'https://api.together.xyz/v1',
      vendor: config.vendor || 'together',
      model: config.model || 'meta-llama/Llama-3.3-70B-Instruct-Turbo'
    })
  }

  static fireworks(config: OpenAIProviderConfig = {}): OpenAIProvider {
    return new OpenAIProvider({
      ...config,
      apiKey: config.apiKey || process.env.FIREWORKS_API_KEY,
      baseURL: config.baseURL || 'https://api.fireworks.ai/inference/v1',
      vendor: config.vendor || 'fireworks',
      model: config.model || 'accounts/fireworks/models/llama-v3p3-70b-instruct'
    })
  }

  static deepseek(config: OpenAIProviderConfig = {}): OpenAIProvider {
    return new OpenAIProvider({
      ...config,
      apiKey: config.apiKey || process.env.DEEPSEEK_API_KEY,
      baseURL: config.baseURL || 'https://api.deepseek.com/v1',
      vendor: config.vendor || 'deepseek',
      model: config.model || 'deepseek-chat'
    })
  }

  static xai(config: OpenAIProviderConfig = {}): OpenAIProvider {
    return new OpenAIProvider({
      ...config,
      apiKey: config.apiKey || process.env.XAI_API_KEY,
      baseURL: config.baseURL || 'https://api.x.ai/v1',
      vendor: config.vendor || 'xai',
      model: config.model || 'grok-2'
    })
  }

  /**
   * Google Gemini exposes an OpenAI-compatible endpoint. Model names match the
   * `google:` cost-pricing keys (`gemini-2.5-flash`, `gemini-2.5-pro`, ...).
   */
  static google(config: OpenAIProviderConfig = {}): OpenAIProvider {
    return new OpenAIProvider({
      ...config,
      apiKey: config.apiKey || process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY,
      baseURL: config.baseURL || 'https://generativelanguage.googleapis.com/v1beta/openai',
      vendor: config.vendor || 'google',
      model: config.model || 'gemini-2.5-flash'
    })
  }

  /**
   * Ollama exposes an OpenAI-compatible endpoint at `<host>/v1/chat/completions`.
   * Auth is unused — Ollama ignores the bearer token but the OpenAI client
   * requires a non-empty Authorization header, so we stub one.
   *
   * `OLLAMA_HOST` (Ollama's standard env var) is honored and gets `/v1`
   * appended. `model` is required — Ollama users pick whatever they pulled
   * (`llama3.2`, `qwen2.5`, `gpt-oss:20b`, ...) and there's no universal default.
   */
  static ollama(config: OpenAIProviderConfig & { model: string }): OpenAIProvider {
    return new OpenAIProvider({
      ...config,
      apiKey: config.apiKey || 'ollama',
      baseURL: config.baseURL || ollamaBaseURL(),
      vendor: config.vendor || 'ollama'
    })
  }
}

function ollamaBaseURL(): string {
  const host = process.env.OLLAMA_HOST
  if (!host) return 'http://localhost:11434/v1'
  // Strip trailing slash, append /v1 unless already present.
  const trimmed = host.replace(/\/+$/, '')
  return trimmed.endsWith('/v1') ? trimmed : `${trimmed}/v1`
}

function safeParseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s
  return `${s.slice(0, max)}…(+${s.length - max} chars)`
}
