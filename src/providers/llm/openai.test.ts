import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { OpenAIProvider } from './openai.js'
import { isTransientError } from './fallback.js'
import type { Message, ToolSchema } from '../../types.js'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  })
}

function textResponse(body: string, status: number, statusText = ''): Response {
  return new Response(body, {
    status,
    statusText,
    headers: { 'Content-Type': 'text/plain' }
  })
}

function okChoice(opts: {
  content?: string | null
  tool_calls?: Array<{ id: string; name: string; args?: unknown }>
  prompt_tokens?: number
  completion_tokens?: number
  cached_tokens?: number
  cache_write_tokens?: number
  finish_reason?: 'stop' | 'tool_calls' | 'length'
} = {}) {
  const promptTokens = opts.prompt_tokens ?? 100
  const completionTokens = opts.completion_tokens ?? 20
  const usage: Record<string, unknown> = {
    prompt_tokens: promptTokens,
    completion_tokens: completionTokens,
    total_tokens: promptTokens + completionTokens
  }
  if (opts.cached_tokens !== undefined || opts.cache_write_tokens !== undefined) {
    usage.prompt_tokens_details = {
      cached_tokens: opts.cached_tokens ?? 0,
      cache_write_tokens: opts.cache_write_tokens ?? 0
    }
  }
  return {
    id: 'resp',
    choices: [
      {
        message: {
          role: 'assistant' as const,
          content: opts.content ?? null,
          tool_calls: opts.tool_calls?.map(tc => ({
            id: tc.id,
            type: 'function' as const,
            function: { name: tc.name, arguments: JSON.stringify(tc.args ?? {}) }
          }))
        },
        finish_reason: opts.finish_reason
          ?? (opts.tool_calls && opts.tool_calls.length > 0 ? 'tool_calls' : 'stop')
      }
    ],
    usage
  }
}

const dummyTool: ToolSchema = {
  name: 'search',
  description: 'search things',
  input_schema: { type: 'object', properties: { q: { type: 'string' } } }
}

describe('OpenAIProvider — construction', () => {
  it('throws when apiKey is missing and OPENAI_API_KEY is unset', () => {
    const prev = process.env.OPENAI_API_KEY
    delete process.env.OPENAI_API_KEY
    try {
      expect(() => new OpenAIProvider()).toThrow(/openai API key is required/)
    } finally {
      if (prev !== undefined) process.env.OPENAI_API_KEY = prev
    }
  })

  it('error message includes the vendor name', () => {
    expect(() => new OpenAIProvider({ vendor: 'groq' })).toThrow(/groq API key is required/)
  })

  it('reads apiKey from process.env.OPENAI_API_KEY', () => {
    const prev = process.env.OPENAI_API_KEY
    process.env.OPENAI_API_KEY = 'env-key'
    try {
      const p = new OpenAIProvider()
      expect(p.getModelId()).toBe('openai:gpt-4o')
    } finally {
      if (prev !== undefined) process.env.OPENAI_API_KEY = prev
      else delete process.env.OPENAI_API_KEY
    }
  })
})

describe('OpenAIProvider — getModelId', () => {
  it('default vendor is openai', () => {
    const p = new OpenAIProvider({ apiKey: 'k', model: 'gpt-4o-mini' })
    expect(p.getModelId()).toBe('openai:gpt-4o-mini')
  })

  it('returns ${vendor}:${model}', () => {
    const p = new OpenAIProvider({ apiKey: 'k', model: 'm', vendor: 'groq' })
    expect(p.getModelId()).toBe('groq:m')
  })
})

describe('OpenAIProvider — vendor presets', () => {
  it('groq preset sets baseURL, vendor, default model', () => {
    const p = OpenAIProvider.groq({ apiKey: 'k' })
    expect(p.getModelId()).toBe('groq:llama-3.3-70b-versatile')
  })

  it('together preset', () => {
    const p = OpenAIProvider.together({ apiKey: 'k' })
    expect(p.getModelId()).toMatch(/^together:/)
  })

  it('fireworks preset', () => {
    const p = OpenAIProvider.fireworks({ apiKey: 'k' })
    expect(p.getModelId()).toMatch(/^fireworks:/)
  })

  it('deepseek preset', () => {
    const p = OpenAIProvider.deepseek({ apiKey: 'k' })
    expect(p.getModelId()).toBe('deepseek:deepseek-chat')
  })

  it('xai preset', () => {
    const p = OpenAIProvider.xai({ apiKey: 'k' })
    expect(p.getModelId()).toBe('xai:grok-2')
  })

  it('preset apiKey falls back to vendor-specific env var', () => {
    const prev = process.env.GROQ_API_KEY
    process.env.GROQ_API_KEY = 'groq-env'
    try {
      const p = OpenAIProvider.groq()
      expect(p.getModelId()).toBe('groq:llama-3.3-70b-versatile')
    } finally {
      if (prev !== undefined) process.env.GROQ_API_KEY = prev
      else delete process.env.GROQ_API_KEY
    }
  })

  it('explicit model overrides preset default', () => {
    const p = OpenAIProvider.groq({ apiKey: 'k', model: 'mixtral-8x7b' })
    expect(p.getModelId()).toBe('groq:mixtral-8x7b')
  })
})

describe('OpenAIProvider.ollama', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('does not require an explicit apiKey', () => {
    expect(() => OpenAIProvider.ollama({ model: 'llama3.2' })).not.toThrow()
  })

  it('sets vendor and namespaces getModelId', () => {
    const p = OpenAIProvider.ollama({ model: 'llama3.2' })
    expect(p.getModelId()).toBe('ollama:llama3.2')
  })

  it('hits localhost:11434/v1 by default', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(okChoice({ content: 'ok' })))

    const p = OpenAIProvider.ollama({ model: 'llama3.2' })
    await p.chat('sys', [{ role: 'user', content: 'hi' }], [])

    const url = vi.mocked(fetch).mock.calls[0][0] as string
    expect(url).toBe('http://localhost:11434/v1/chat/completions')
  })

  it('appends /v1 when OLLAMA_HOST is set without it', async () => {
    const prev = process.env.OLLAMA_HOST
    process.env.OLLAMA_HOST = 'http://192.168.1.5:11434'
    try {
      vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(okChoice({ content: 'ok' })))

      const p = OpenAIProvider.ollama({ model: 'llama3.2' })
      await p.chat('sys', [{ role: 'user', content: 'hi' }], [])

      const url = vi.mocked(fetch).mock.calls[0][0] as string
      expect(url).toBe('http://192.168.1.5:11434/v1/chat/completions')
    } finally {
      if (prev !== undefined) process.env.OLLAMA_HOST = prev
      else delete process.env.OLLAMA_HOST
    }
  })

  it('does NOT double-append /v1 when OLLAMA_HOST already includes it', async () => {
    const prev = process.env.OLLAMA_HOST
    process.env.OLLAMA_HOST = 'http://localhost:11434/v1'
    try {
      vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(okChoice({ content: 'ok' })))

      const p = OpenAIProvider.ollama({ model: 'qwen2.5' })
      await p.chat('sys', [{ role: 'user', content: 'hi' }], [])

      const url = vi.mocked(fetch).mock.calls[0][0] as string
      expect(url).toBe('http://localhost:11434/v1/chat/completions')
    } finally {
      if (prev !== undefined) process.env.OLLAMA_HOST = prev
      else delete process.env.OLLAMA_HOST
    }
  })

  it('explicit baseURL overrides OLLAMA_HOST', async () => {
    const prev = process.env.OLLAMA_HOST
    process.env.OLLAMA_HOST = 'http://wrong:11434'
    try {
      vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(okChoice({ content: 'ok' })))

      const p = OpenAIProvider.ollama({ model: 'llama3.2', baseURL: 'http://right:9000/v1' })
      await p.chat('sys', [{ role: 'user', content: 'hi' }], [])

      const url = vi.mocked(fetch).mock.calls[0][0] as string
      expect(url).toBe('http://right:9000/v1/chat/completions')
    } finally {
      if (prev !== undefined) process.env.OLLAMA_HOST = prev
      else delete process.env.OLLAMA_HOST
    }
  })
})

describe('OpenAIProvider — chat success path', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns text content for a plain assistant reply', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(okChoice({ content: 'hello' })))

    const p = new OpenAIProvider({ apiKey: 'k' })
    const result = await p.chat('sys', [{ role: 'user', content: 'hi' }], [])

    expect(result.stopReason).toBe('end_turn')
    expect(result.content).toEqual([{ type: 'text', text: 'hello' }])
    expect(result.usage).toEqual({ inputTokens: 100, outputTokens: 20 })
  })

  it('maps finish_reason=tool_calls to stopReason=tool_use and emits tool_use blocks', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(okChoice({
      tool_calls: [{ id: 't1', name: 'search', args: { q: 'milk' } }]
    })))

    const p = new OpenAIProvider({ apiKey: 'k' })
    const result = await p.chat('sys', [{ role: 'user', content: 'hi' }], [dummyTool])

    expect(result.stopReason).toBe('tool_use')
    expect(result.content).toEqual([
      { type: 'tool_use', id: 't1', name: 'search', input: { q: 'milk' } }
    ])
  })

  it('maps finish_reason=length to stopReason=max_tokens', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(okChoice({
      content: 'truncated...',
      finish_reason: 'length'
    })))

    const p = new OpenAIProvider({ apiKey: 'k' })
    const result = await p.chat('sys', [{ role: 'user', content: 'hi' }], [])

    expect(result.stopReason).toBe('max_tokens')
  })

  it('plumbs cached_tokens and cache_write_tokens into LLMResponse.cacheUsage and excludes them from inputTokens', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(okChoice({
      content: 'ok',
      prompt_tokens: 1000,
      completion_tokens: 50,
      cached_tokens: 800,
      cache_write_tokens: 100
    })))

    const p = new OpenAIProvider({ apiKey: 'k' })
    const result = await p.chat('sys', [{ role: 'user', content: 'hi' }], [])

    expect(result.cacheUsage).toEqual({
      cacheReadInputTokens: 800,
      cacheCreationInputTokens: 100
    })
    expect(result.usage).toEqual({ inputTokens: 100, outputTokens: 50 })
  })

  it('does not emit cacheUsage when prompt_tokens_details is absent', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(okChoice({ content: 'ok' })))

    const p = new OpenAIProvider({ apiKey: 'k' })
    const result = await p.chat('sys', [{ role: 'user', content: 'hi' }], [])

    expect(result.cacheUsage).toBeUndefined()
  })
})

describe('OpenAIProvider — request body shape', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function lastBody(): Record<string, unknown> {
    const fetchMock = vi.mocked(fetch)
    const call = fetchMock.mock.calls[fetchMock.mock.calls.length - 1]
    const init = call[1] as RequestInit
    return JSON.parse(init.body as string) as Record<string, unknown>
  }

  function lastHeaders(): Record<string, string> {
    const fetchMock = vi.mocked(fetch)
    const call = fetchMock.mock.calls[fetchMock.mock.calls.length - 1]
    const init = call[1] as RequestInit
    return init.headers as Record<string, string>
  }

  it('forwards options.temperature, options.topP, options.stopSequences', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(okChoice({ content: 'ok' })))

    const p = new OpenAIProvider({ apiKey: 'k' })
    await p.chat('sys', [{ role: 'user', content: 'hi' }], [], {
      temperature: 0.3,
      topP: 0.9,
      stopSequences: ['\n\n', 'STOP']
    })

    const body = lastBody()
    expect(body.temperature).toBe(0.3)
    expect(body.top_p).toBe(0.9)
    expect(body.stop).toEqual(['\n\n', 'STOP'])
  })

  it('omits sampling params when not provided', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(okChoice({ content: 'ok' })))

    const p = new OpenAIProvider({ apiKey: 'k' })
    await p.chat('sys', [{ role: 'user', content: 'hi' }], [])

    const body = lastBody()
    expect(body.temperature).toBeUndefined()
    expect(body.top_p).toBeUndefined()
    expect(body.stop).toBeUndefined()
  })

  it('options.model overrides the constructor default', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(okChoice({ content: 'ok' })))

    const p = new OpenAIProvider({ apiKey: 'k', model: 'gpt-4o' })
    await p.chat('sys', [{ role: 'user', content: 'hi' }], [], { model: 'gpt-4o-mini' })

    expect(lastBody().model).toBe('gpt-4o-mini')
  })

  it('attaches Authorization header and merges defaultHeaders', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(okChoice({ content: 'ok' })))

    const p = new OpenAIProvider({
      apiKey: 'secret',
      defaultHeaders: { 'X-Custom': 'yes' }
    })
    await p.chat('sys', [{ role: 'user', content: 'hi' }], [])

    const headers = lastHeaders()
    expect(headers['Authorization']).toBe('Bearer secret')
    expect(headers['Content-Type']).toBe('application/json')
    expect(headers['X-Custom']).toBe('yes')
  })

  it('hits the configured baseURL', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(okChoice({ content: 'ok' })))

    const p = OpenAIProvider.groq({ apiKey: 'k' })
    await p.chat('sys', [{ role: 'user', content: 'hi' }], [])

    const fetchMock = vi.mocked(fetch)
    const url = fetchMock.mock.calls[0][0] as string
    expect(url).toBe('https://api.groq.com/openai/v1/chat/completions')
  })
})

describe('OpenAIProvider — message conversion', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function lastMessages(): Array<Record<string, unknown>> {
    const fetchMock = vi.mocked(fetch)
    const call = fetchMock.mock.calls[fetchMock.mock.calls.length - 1]
    const body = JSON.parse((call[1] as RequestInit).body as string) as Record<string, unknown>
    return body.messages as Array<Record<string, unknown>>
  }

  it('prepends the system prompt as the first message', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(okChoice({ content: 'ok' })))

    const p = new OpenAIProvider({ apiKey: 'k' })
    await p.chat('be helpful', [{ role: 'user', content: 'hi' }], [])

    const msgs = lastMessages()
    expect(msgs[0]).toEqual({ role: 'system', content: 'be helpful' })
    expect(msgs[1]).toEqual({ role: 'user', content: 'hi' })
  })

  it('roundtrips assistant tool_use → tool_call and tool_result → tool role', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(okChoice({ content: 'done' })))

    const messages: Message[] = [
      { role: 'user', content: 'find milk' },
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'searching' },
          { type: 'tool_use', id: 't1', name: 'search', input: { q: 'milk' } }
        ]
      },
      {
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: 't1', content: '[{"name":"milk"}]' }
        ]
      }
    ]

    const p = new OpenAIProvider({ apiKey: 'k' })
    await p.chat('sys', messages, [dummyTool])

    const msgs = lastMessages()
    // [system, user, assistant-with-tool_calls, tool]
    expect(msgs).toHaveLength(4)
    expect(msgs[2].role).toBe('assistant')
    expect(msgs[2].content).toBe('searching')
    expect(msgs[2].tool_calls).toEqual([
      { id: 't1', type: 'function', function: { name: 'search', arguments: JSON.stringify({ q: 'milk' }) } }
    ])
    expect(msgs[3]).toEqual({
      role: 'tool',
      content: '[{"name":"milk"}]',
      tool_call_id: 't1'
    })
  })

  it('converts tool schemas to OpenAI function form', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(okChoice({ content: 'ok' })))

    const p = new OpenAIProvider({ apiKey: 'k' })
    await p.chat('sys', [{ role: 'user', content: 'hi' }], [dummyTool])

    const fetchMock = vi.mocked(fetch)
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string) as Record<string, unknown>
    expect(body.tools).toEqual([
      {
        type: 'function',
        function: {
          name: 'search',
          description: 'search things',
          parameters: { type: 'object', properties: { q: { type: 'string' } } }
        }
      }
    ])
  })

  it('omits the tools field when no tools are provided', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(okChoice({ content: 'ok' })))

    const p = new OpenAIProvider({ apiKey: 'k' })
    await p.chat('sys', [{ role: 'user', content: 'hi' }], [])

    const fetchMock = vi.mocked(fetch)
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string) as Record<string, unknown>
    expect(body.tools).toBeUndefined()
  })
})

describe('OpenAIProvider — reasoning stripping', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('strips harmony channel markers from text content by default', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(okChoice({
      content: '<|channel|>analysis<|message|>Plain answer here.'
    })))

    const p = new OpenAIProvider({ apiKey: 'k' })
    const result = await p.chat('sys', [{ role: 'user', content: 'hi' }], [])

    expect(result.content).toEqual([{ type: 'text', text: 'Plain answer here.' }])
  })

  it('strips a leading `thought` preamble', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(okChoice({
      content: 'thought\nThe real answer.'
    })))

    const p = new OpenAIProvider({ apiKey: 'k' })
    const result = await p.chat('sys', [{ role: 'user', content: 'hi' }], [])

    expect(result.content).toEqual([{ type: 'text', text: 'The real answer.' }])
  })

  it('preserves the raw text when stripReasoning is false', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(okChoice({
      content: '<|channel|>analysis<|message|>Plain answer here.'
    })))

    const p = new OpenAIProvider({ apiKey: 'k', stripReasoning: false })
    const result = await p.chat('sys', [{ role: 'user', content: 'hi' }], [])

    expect(result.content).toEqual([
      { type: 'text', text: '<|channel|>analysis<|message|>Plain answer here.' }
    ])
  })
})

describe('OpenAIProvider — error handling', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('throws with vendor name and HTTP status on a non-2xx', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({ error: { message: 'bad key' } }, 401)
    )

    const p = new OpenAIProvider({ apiKey: 'k', vendor: 'groq' })
    await expect(
      p.chat('sys', [{ role: 'user', content: 'hi' }], [])
    ).rejects.toThrow(/groq API error \(HTTP 401\): bad key/)
  })

  it('throws on a 503 in a way that isTransientError classifies as transient', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      textResponse('upstream busy', 503, 'Service Unavailable')
    )

    const p = new OpenAIProvider({ apiKey: 'k', vendor: 'groq' })

    let caught: unknown
    try {
      await p.chat('sys', [{ role: 'user', content: 'hi' }], [])
    } catch (err) {
      caught = err
    }
    expect(caught).toBeInstanceOf(Error)
    expect(isTransientError(caught)).toBe(true)
  })

  it('throws on a 401 in a way that isTransientError rejects', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({ error: { message: 'bad key' } }, 401)
    )

    const p = new OpenAIProvider({ apiKey: 'k' })

    let caught: unknown
    try {
      await p.chat('sys', [{ role: 'user', content: 'hi' }], [])
    } catch (err) {
      caught = err
    }
    expect(isTransientError(caught)).toBe(false)
  })

  it('throws when the response body is not JSON', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(textResponse('not-json', 200))

    const p = new OpenAIProvider({ apiKey: 'k' })
    await expect(
      p.chat('sys', [{ role: 'user', content: 'hi' }], [])
    ).rejects.toThrow(/openai API error: response was not valid JSON/)
  })

  it('throws when 200 OK carries an error body', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ error: { message: 'rate limited' } }))

    const p = new OpenAIProvider({ apiKey: 'k' })
    await expect(
      p.chat('sys', [{ role: 'user', content: 'hi' }], [])
    ).rejects.toThrow(/openai API error: rate limited/)
  })

  it('throws when no choices are returned', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({
      id: 'r',
      choices: [],
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }
    }))

    const p = new OpenAIProvider({ apiKey: 'k' })
    await expect(
      p.chat('sys', [{ role: 'user', content: 'hi' }], [])
    ).rejects.toThrow(/empty response/)
  })
})
