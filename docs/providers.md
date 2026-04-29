# LLM Providers

## Prompt caching summary

Caching reduces input-token cost dramatically (often 10× cheaper on cache reads). Behaviour differs per provider:

- **`ClaudeProvider`** — caching is always on. Breakpoints are placed automatically on the system prompt, the last tool, and the last user message.
- **`OpenAIProvider`** — OpenAI handles caching server-side automatically. No client-side breakpoints exist.
- **`OpenRouterProvider`** — caching support depends on the upstream the request is routed to. Client-side breakpoints are **off by default**; opt in with `explicitCacheControl: true` when targeting Anthropic models (or Gemini in explicit mode). Most other upstreams (OpenAI, DeepSeek, Grok, Groq, Moonshot, Gemini 2.5+ implicit) cache automatically without breakpoints.

## Claude (Anthropic)

```typescript
import { ClaudeProvider } from 'tuplet'

const provider = new ClaudeProvider({
  apiKey: process.env.ANTHROPIC_API_KEY,
  model: 'claude-sonnet-4-20250514',  // default
  maxTokens: 8192,                    // default
  baseURL: '...',                     // optional, for proxies
})
```

## OpenAI

```typescript
import { OpenAIProvider } from 'tuplet'

const provider = new OpenAIProvider({
  apiKey: process.env.OPENAI_API_KEY,
  model: 'gpt-4o',       // default
  maxTokens: 4096,        // default
  baseURL: '...'          // optional, for Azure or proxies
})
```

### OpenAI options

| Option | Default | Purpose |
| --- | --- | --- |
| `apiKey` | `process.env.OPENAI_API_KEY` | API key. Vendor presets fall back to vendor-specific env vars (`GROQ_API_KEY`, `TOGETHER_API_KEY`, etc.). |
| `model` | `gpt-4o` | Model identifier. Vendor presets set sensible defaults (e.g. `llama-3.3-70b-versatile` for Groq). |
| `baseURL` | `https://api.openai.com/v1` | Chat-completions endpoint root — set by presets, override for Azure / proxies. |
| `vendor` | `openai` | Namespace for `getModelId()` (`${vendor}:${model}`). Cost-pricing tables and trace events key off this. |
| `stripReasoning` | `true` | Strip reasoning-channel artifacts (`<\|channel\|>`, leading `thought\n`) from text content. Set `false` to render the reasoning stream yourself. |
| `defaultHeaders` | `{}` | Extra headers merged into every request — for vendors that need a custom one. |
| `maxTokens` | `4096` | Generation cap forwarded as `max_tokens`. |

### Sampling parameters per call

`temperature`, `topP`, and `stopSequences` on `LLMOptions` are forwarded to the request body. Other providers ignore them today.

```typescript
const result = await agent.run('Summarise', {
  llmOptions: { temperature: 0.2, topP: 0.9, stopSequences: ['\n\n'] }
})
```

### OpenAI-compatible vendors

Many vendors expose the same `POST /chat/completions` shape. Use the static factories instead of typing base URLs by hand:

```typescript
import { OpenAIProvider } from 'tuplet'

OpenAIProvider.groq({ model: 'llama-3.3-70b-versatile' })       // GROQ_API_KEY
OpenAIProvider.together({ model: 'meta-llama/Llama-3.3-70B-Instruct-Turbo' })  // TOGETHER_API_KEY
OpenAIProvider.fireworks({ model: 'accounts/fireworks/models/llama-v3p3-70b-instruct' })  // FIREWORKS_API_KEY
OpenAIProvider.deepseek({ model: 'deepseek-chat' })             // DEEPSEEK_API_KEY
OpenAIProvider.xai({ model: 'grok-2' })                          // XAI_API_KEY
OpenAIProvider.ollama({ model: 'llama3.2' })                     // local, OLLAMA_HOST
```

Each preset sets `baseURL`, the `vendor` namespace for `getModelId()`, the env-var fallback for `apiKey`, and a sensible default model. Anything you pass in `config` overrides the preset.

`OpenAIProvider.ollama()` is the local-development case: no API key needed, default `baseURL` is `http://localhost:11434/v1`, and `OLLAMA_HOST` is honoured (gets `/v1` appended if missing). `model` is required — pick whichever model you've pulled.

For any other OpenAI-compatible vendor, pass `baseURL` and `vendor` directly:

```typescript
new OpenAIProvider({
  apiKey: process.env.MOONSHOT_API_KEY,
  baseURL: 'https://api.moonshot.cn/v1',
  vendor: 'moonshot',
  model: 'moonshot-v1-128k'
})
```

`OpenRouterProvider` is a separate gateway and stays the right choice when you want OpenRouter's routing, caching breakpoints, and fuzzy-retry behaviour.

## OpenRouter

[OpenRouter](https://openrouter.ai) is a gateway to hundreds of models. The dedicated `OpenRouterProvider` adds prompt-caching breakpoints, provider routing, fuzzy-response retries, and a request-log hook on top of the OpenAI-compatible API.

```typescript
import { OpenRouterProvider } from 'tuplet'

const provider = new OpenRouterProvider({
  apiKey: process.env.OPENROUTER_API_KEY,
  model: 'anthropic/claude-sonnet-4',  // default
  maxTokens: 8192,                     // default
})
```

### Options

| Option | Default | Purpose |
| --- | --- | --- |
| `explicitCacheControl` | `false` | When `true`, attach Anthropic-style `cache_control: { type: "ephemeral" }` breakpoints to the system prompt, the last tool, and the last user message. Turn on for `anthropic/*` models (and Gemini in explicit mode). Leaving off is safer because some strict upstreams reject the unknown field with HTTP 400. |
| `provider` | `undefined` | Pass-through for OpenRouter's [Provider Routing](https://openrouter.ai/docs/features/provider-routing) — pin to a specific upstream when only some support the features you need. Example: `{ order: ['Ionstream'], allow_fallbacks: false }`. |
| `maxFuzzyRetries` | `2` | Retries on broken responses (empty content, leaked chat-template markers like `<\|tool_call\|>`, or `finish_reason=length` with no tool calls when tools were available). Set to `0` to disable. |
| `throwOnFuzzyExhaustion` | `true` | When all fuzzy retries fail, throw instead of returning the last broken response. Set to `false` to render a fallback yourself. |
| `sanitizeOutput` | `true` | Strip reasoning-channel artifacts (`<\|channel\|>`, leading `thought\n`, etc.) from the assistant's text content. Set to `false` to render the reasoning stream yourself. |
| `onRequestLog` | `undefined` | Hook fired once per HTTP exchange with the request body, response body, status, and duration. Designed for cache debugging — see below. |
| `referer`, `title` | `undefined` | Forwarded as `HTTP-Referer` and `X-Title` headers (used by OpenRouter for analytics and ranked-model lists). |

### Caching with Anthropic models

```typescript
const provider = new OpenRouterProvider({
  apiKey: process.env.OPENROUTER_API_KEY,
  model: 'anthropic/claude-haiku-4-5',
  explicitCacheControl: true,        // place breakpoints
})
```

The first turn pays full input cost. Turn 2 onwards, the system prompt + tools + previous messages hit the cache and bill at ~10% of the input rate. Inspect `result.trace.totalCacheReadTokens` and `result.trace.totalCacheCreationTokens` to confirm.

### Pinning a specific upstream

For `google/gemma-4-26b-a4b-it`, only the Ionstream upstream prices cache reads. Pin to it:

```typescript
const provider = new OpenRouterProvider({
  apiKey: process.env.OPENROUTER_API_KEY,
  model: 'google/gemma-4-26b-a4b-it',
  provider: { order: ['Ionstream'], allow_fallbacks: false },
})
```

`allow_fallbacks: false` means OpenRouter will return an error if Ionstream is down rather than silently routing to a non-caching upstream. Drop or flip to `true` if you'd rather take a non-cached fallback over a hard failure.

### Debugging cache hits with `onRequestLog`

Cache hits require a byte-identical prefix across requests. Even one changed character in the system prompt or tools list busts the cache. To find the culprit, capture every HTTP exchange and diff successive entries:

```typescript
import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

mkdirSync('./openrouter-debug', { recursive: true })
let counter = 0

const provider = new OpenRouterProvider({
  apiKey: process.env.OPENROUTER_API_KEY,
  model: 'anthropic/claude-haiku-4-5',
  explicitCacheControl: true,
  onRequestLog: (entry) => {
    const file = join('./openrouter-debug', `${entry.timestamp}-${counter++}.json`)
    writeFileSync(file, JSON.stringify(entry, null, 2))
  },
})
```

Run the same scenario twice, then:

```bash
ls -1 openrouter-debug/ | tail -n 2
diff <(jq -S .request openrouter-debug/<older>.json) \
     <(jq -S .request openrouter-debug/<newer>.json)
```

Any diff in `request.messages[0]` (system) or `request.tools` is enough to defeat caching. Common culprits: dynamic dates, user IDs, conversation IDs, randomized tool order, or a fresh timestamp inserted into the system prompt.

The hook payload (`OpenRouterLogEntry`):

```typescript
{
  timestamp: number       // unix ms when the POST started
  url: string
  request: Record<string, unknown>   // exact payload sent to OpenRouter
  response: {
    status: number
    ok: boolean
    body: unknown         // parsed response JSON if valid
    rawBody: string       // raw text fallback
  }
  durationMs: number
  error?: string          // present when the call threw
}
```

Errors thrown from inside the hook are swallowed — logging cannot break the request path. The auth header and API key are never included in the payload.

## Mixed Providers

Main agent and [sub-agents](./sub-agents.md) can use different providers:

```typescript
const agent = new Tuplet({
  role: '...',
  agents: [{
    name: 'fast_helper',
    description: 'Quick tasks',
    systemPrompt: '...',
    tools: [...],
    llm: new OpenAIProvider({ apiKey: '...', model: 'gpt-4o-mini' })
  }],
  llm: new ClaudeProvider({ apiKey: '...' })
})
```

## Custom Provider

Implement `LLMProvider` to use any LLM:

```typescript
import type { LLMProvider, LLMResponse, Message, ToolSchema, LLMOptions } from 'tuplet'

class CustomProvider implements LLMProvider {
  async chat(
    systemPrompt: string,
    messages: Message[],
    tools: ToolSchema[],
    options?: LLMOptions
  ): Promise<LLMResponse> {
    const response = await yourApi.chat({ system: systemPrompt, messages, tools })

    return {
      content: [{ type: 'text', text: response.text }],
      stopReason: response.finishReason === 'tool_calls' ? 'tool_use' : 'end_turn',
      usage: {
        inputTokens: response.usage.promptTokens,
        outputTokens: response.usage.completionTokens
      }
    }
  }

  getModelId(): string {
    return 'custom:my-model'
  }
}
```
