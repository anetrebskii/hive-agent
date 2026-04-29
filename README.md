# Tuplet

> Formerly **Hive Agent** ([`@alexnetrebskii/hive-agent`](https://www.npmjs.com/package/@alexnetrebskii/hive-agent)) — same framework, new name.

[![npm version](https://img.shields.io/npm/v/tuplet)](https://www.npmjs.com/package/tuplet)
[![CI](https://img.shields.io/github/actions/workflow/status/anetrebskii/tuplet/ci.yml)](https://github.com/anetrebskii/tuplet/actions)
[![license](https://img.shields.io/github/license/anetrebskii/tuplet)](https://github.com/anetrebskii/tuplet/blob/main/LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue)](https://www.typescriptlang.org/)
[![Discord](https://img.shields.io/discord/1339330498498080808?logo=discord&label=Discord)](https://discord.gg/WrZhA6wfdr)

**Claude Code-like AI agent for your own application. Add a few lines — get a multi-agent system that asks clarifying questions, plans tasks, and works with your data.**

Claude Code is impressive: you open a terminal, ask it to code something, and it plans, clarifies, executes. But it's locked to the terminal and local filesystem. What if you need that same intelligence inside your SaaS product, web app, or serverless function — working with your database, your blob storage, your users' data?

Tuplet gives you exactly that. A powerful, multi-agent framework you plug into your application. Your users get an AI that feels custom-built. You get a library that handles the hard parts.

## Demo

<!-- VIDEO_PLACEHOLDER: Replace with uploaded video -->
<!-- Example: https://github.com/user-attachments/assets/xxxxx -->

> See Tuplet in action — AI agent planning tasks, asking clarifying questions, and working with workspace files in a real web app.

## You Need Tuplet If

- You want your own AI agent in your app that codes, manages documents, or works with any workspace you share with it
- You're building on Firebase, Vercel, AWS Lambda, or any serverless platform — Tuplet is stateless by design
- You're building a SaaS and want to give users a smart AI chat without building an agent framework from scratch
- Your data lives in databases, blob storage, or APIs — not just the local filesystem
- You want Claude Code-level intelligence but inside a web application, without VMs or infrastructure to manage
- You don't want to spend time teaching AI how to work well — Tuplet handles planning, task tracking, clarifying questions, and tool use out of the box

## Features

### Agent Intelligence

- **Built-in planning & exploration sub-agents** — AI plans its work before executing, just like Claude Code
- **Task generation & tracking** — AI generates tasks and follows them, showing progress in real time
- **Rich progress events** — Stream AI reasoning text, tool execution, token usage, and nested sub-agent activity with structured depth for tree-like UIs. Every event includes a typed `activity` classification and a user-friendly `label` — just `statusBar.setText(update.label)` and you're done
- **Clarifying questions** — AI asks one question or a series of questions when it needs more context
- **Interruption mode** — Correct the AI mid-execution if it goes in the wrong direction, just like Claude Code
- **Optimized built-in prompts** — Carefully tuned prompts for better results across all providers

### Built-in Capabilities

- **Workspace** — Like projects in Claude Code. Tuplet works with workspace files (virtual or real) the same way Claude Code works with your project. Strict mode restricts AI to defined paths with schema validation — all writes (including shell redirections) are validated automatically
- **Large file processing** — AI reads files >256KB in chunks, just like Claude Code does
- **Web browsing** — Navigate websites, extract data, interact with pages
- **API requests with authentication** — Make HTTP requests to external services
- **URL allowlisting** — Restrict which URLs the agent can access via `curl`/`browse` with wildcard patterns (`https://*.example.com/api/**`)

### Multi-Provider

- **Claude** (Anthropic) — First-class support with caching and extended thinking
- **OpenAI** — GPT-4o and other models, plus one-call presets for OpenAI-compatible vendors (Groq, Together, Fireworks, DeepSeek, xAI, Ollama)
- **OpenRouter** — Access to 100+ models via [openrouter.ai](https://openrouter.ai), with optimized prompts so non-Claude models use built-in tools effectively
- **Custom providers** — Implement the `LLMProvider` interface to use any AI model

### Cost & Performance

- **Prompt caching** — Up to 90% cost reduction with Claude's prompt caching
- **Chat history summarization** — Automatic summarization of long conversations to stay within context limits
- **Execution tracing** — Full cost breakdown per request, per model, per sub-agent

### Production-Ready

- **Stateless design** — Works in Firebase Functions, AWS Lambda, any serverless environment
- **Conversation history management** — Automatic load/save with pluggable repository providers
- **Secrets management** — Keep credentials for external systems outside AI context. AI can use them without seeing actual values
- **Interruption & cancellation** — AbortController support, Firestore-based stop signals, graceful partial results

### Extensibility

- **Custom tools** — Define any tool with typed parameters and execution logic
- **Skills** — Lazy-loaded prompts for specialized workflows. Only metadata is in the system prompt; full instructions load on demand when the model activates a skill
- **Custom sub-agents** — Spawn specialized agents with their own tools, prompts, and even different LLM providers
- **Pluggable storage** — Bring your own chat history provider (Firestore, Redis, Postgres, anything)
- **Pluggable logging & tracing** — Built-in [Langfuse](https://langfuse.com) provider, console tracer, or wire your own (Datadog, custom dashboards, any observability platform). See [Tracing](./docs/tracing.md).
- **Pluggable workspaces** — Virtual file systems, database-backed storage, or real file system

## Tuplet vs LangChain.js

| | **Tuplet** | **LangChain.js** |
|---|---|---|
| **Runtime dependencies** | 0 | 11+ (core) + per-provider packages |
| **Setup** | `new Tuplet({ tools, llm })` — one object, done | Chains, Runnables, LCEL, Memory, Agents — multiple abstractions to learn |
| **Planning & task tracking** | Built-in, works out of the box | Requires separate `@langchain/langgraph` package |
| **Clarifying questions** | Built-in | Not included — build your own |
| **Serverless** | Stateless by design — drop into Lambda/Firebase as-is | Requires external state management and architectural changes |
| **Multi-provider** | Claude, OpenAI, OpenRouter (100+ models), custom | 50+ providers via separate packages |
| **Prompt caching** | Built-in for Claude (up to 90% cost savings) | Not built-in |
| **Best for** | Production apps that need an embedded AI agent | Prototyping, RAG pipelines, complex LLM orchestration |

**When to choose LangChain:** You need a massive ecosystem of integrations (vector stores, retrievers, 50+ providers) or are building complex RAG pipelines with many data sources.

**When to choose Tuplet:** You want a production-ready agent in your app without the abstraction overhead. One dependency, stateless, works in serverless — and your users get planning, task tracking, and clarifying questions out of the box.

## Installation

```bash
npm install tuplet
```

```bash
pnpm add tuplet
```

## Quick Start

```typescript
import { Tuplet, ClaudeProvider } from 'tuplet'

const agent = new Tuplet({
  role: 'a helpful assistant',
  tools: [myTool],
  llm: new ClaudeProvider({ apiKey: process.env.ANTHROPIC_API_KEY })
})

const result = await agent.run('Hello!')
console.log(result.response)
```

### Using OpenAI-compatible providers

`OpenAIProvider` works with OpenAI directly and with any OpenAI-compatible vendor — Groq, Together, Fireworks, DeepSeek, xAI — via static presets that fill in `baseURL`, the env-var fallback, and a default model:

```typescript
import { Tuplet, OpenAIProvider } from 'tuplet'

const agent = new Tuplet({
  role: 'a helpful assistant',
  tools: [myTool],
  llm: OpenAIProvider.groq({ model: 'llama-3.3-70b-versatile' })  // reads GROQ_API_KEY
})
```

For other compatible vendors pass `baseURL` and `vendor` directly. See [Providers](./docs/providers.md) for the full list.

## Examples

- [**Coder**](https://github.com/anetrebskii/tuplet/tree/main/examples/coder) — AI software developer that creates projects from scratch using built-in shell, workspace, planning, and task tracking. Zero custom tools.
- [**Eating Consultant**](https://github.com/anetrebskii/tuplet/tree/main/examples/eating-consultant) — Nutrition assistant with custom tools (OpenFoodFacts API), sub-agents (meal planner), workspace persistence, and run recording.

## Documentation

- [Quick Start](https://github.com/anetrebskii/tuplet/blob/main/docs/README.md)
- [Tools](https://github.com/anetrebskii/tuplet/blob/main/docs/tools.md)
- [Skills](https://github.com/anetrebskii/tuplet/blob/main/docs/skills.md)
- [Sub-Agents](https://github.com/anetrebskii/tuplet/blob/main/docs/sub-agents.md)
- [Workspace](https://github.com/anetrebskii/tuplet/blob/main/docs/workspace.md)
- [URL Allowlisting](https://github.com/anetrebskii/tuplet/blob/main/docs/url-allowlist.md)
- [Secrets](https://github.com/anetrebskii/tuplet/blob/main/docs/secrets.md)
- [Providers](https://github.com/anetrebskii/tuplet/blob/main/docs/providers.md)
- [History](https://github.com/anetrebskii/tuplet/blob/main/docs/history.md)
- [Interactive Questions](https://github.com/anetrebskii/tuplet/blob/main/docs/interactive.md)
- [Interruption](https://github.com/anetrebskii/tuplet/blob/main/docs/interruption.md)
- [Plan Mode](https://github.com/anetrebskii/tuplet/blob/main/docs/plan-mode.md)
- [Task Management](https://github.com/anetrebskii/tuplet/blob/main/docs/task-management.md)
- [Progress Status](https://github.com/anetrebskii/tuplet/blob/main/docs/progress-status.md)
- [Logger](https://github.com/anetrebskii/tuplet/blob/main/docs/logger.md)
- [Tracing](https://github.com/anetrebskii/tuplet/blob/main/docs/tracing.md)
- [Run Recording](https://github.com/anetrebskii/tuplet/blob/main/docs/run-recording.md)
- [Prompt Sections & History Injections](https://github.com/anetrebskii/tuplet/blob/main/docs/prompt-sections.md)

## License

MIT
