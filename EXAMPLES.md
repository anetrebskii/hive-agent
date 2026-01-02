# Hive Agent Examples

Practical examples for common use cases.

## Table of Contents

- [Basic Chat Bot](#basic-chat-bot)
- [Tool-Using Agent](#tool-using-agent)
- [Firebase Function Handler](#firebase-function-handler)
- [Telegram Bot](#telegram-bot)
- [Multi-Agent System](#multi-agent-system)
- [Mixed Providers](#mixed-providers)
- [Interactive Workflows](#interactive-workflows)
- [Progress Tracking](#progress-tracking)
- [Context Management](#context-management)

---

## Basic Chat Bot

Simple conversational agent without tools:

```typescript
import { Hive, ClaudeProvider } from 'hive-agent'

const agent = new Hive({
  systemPrompt: `You are a friendly assistant. Be concise and helpful.`,
  tools: [],
  llm: new ClaudeProvider({ apiKey: process.env.ANTHROPIC_API_KEY })
})

// Single message
const result = await agent.run('What is TypeScript?')
console.log(result.response)

// With conversation history
let history = []
const r1 = await agent.run('My name is Alex', { history })
history = r1.history

const r2 = await agent.run('What is my name?', { history })
console.log(r2.response) // "Your name is Alex"
```

---

## Tool-Using Agent

Agent with custom tools:

```typescript
import { Hive, ClaudeProvider, type Tool } from 'hive-agent'

// Calculator tool
const calculatorTool: Tool = {
  name: 'calculate',
  description: 'Perform mathematical calculations',
  parameters: {
    type: 'object',
    properties: {
      expression: {
        type: 'string',
        description: 'Math expression to evaluate (e.g., "2 + 2 * 3")'
      }
    },
    required: ['expression']
  },
  execute: async ({ expression }) => {
    try {
      // Safe evaluation (use a proper math library in production)
      const result = Function(`"use strict"; return (${expression})`)()
      return { success: true, data: { result } }
    } catch (error) {
      return { success: false, error: 'Invalid expression' }
    }
  }
}

// File reader tool
const readFileTool: Tool = {
  name: 'read_file',
  description: 'Read contents of a file',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'File path to read' },
      lines: { type: 'number', description: 'Max lines to read (default: 100)' }
    },
    required: ['path']
  },
  execute: async ({ path, lines = 100 }, context) => {
    const fs = await import('fs/promises')
    try {
      const content = await fs.readFile(path as string, 'utf-8')
      const limitedContent = content.split('\n').slice(0, lines as number).join('\n')
      return { success: true, data: { content: limitedContent } }
    } catch (error) {
      return { success: false, error: `Cannot read file: ${path}` }
    }
  }
}

const agent = new Hive({
  systemPrompt: 'You help users with calculations and file operations.',
  tools: [calculatorTool, readFileTool],
  llm: new ClaudeProvider({ apiKey: process.env.ANTHROPIC_API_KEY })
})

const result = await agent.run('What is 15% of 250?')
// Agent uses calculate tool and responds with "37.5"
```

---

## Firebase Function Handler

Stateless handler for serverless deployment:

```typescript
import { Hive, ClaudeProvider } from 'hive-agent'
import * as functions from 'firebase-functions'
import * as admin from 'firebase-admin'

admin.initializeApp()
const db = admin.firestore()

const agent = new Hive({
  systemPrompt: 'You are a helpful assistant.',
  tools: [/* your tools */],
  llm: new ClaudeProvider({ apiKey: process.env.ANTHROPIC_API_KEY })
})

export const chat = functions.https.onRequest(async (req, res) => {
  const { message, conversationId } = req.body

  // Load conversation history
  const doc = await db.collection('conversations').doc(conversationId).get()
  const history = doc.exists ? doc.data()?.messages || [] : []

  // Run agent
  const result = await agent.run(message, { history })

  // Save updated history
  await db.collection('conversations').doc(conversationId).set({
    messages: result.history,
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  })

  // Handle interactive questions
  if (result.status === 'needs_input') {
    res.json({
      type: 'question',
      question: result.pendingQuestion?.question,
      options: result.pendingQuestion?.options
    })
    return
  }

  res.json({
    type: 'response',
    message: result.response
  })
})
```

---

## Telegram Bot

Complete Telegram bot with interactive questions:

```typescript
import { Hive, ClaudeProvider, type Message } from 'hive-agent'
import TelegramBot from 'node-telegram-bot-api'

const bot = new TelegramBot(process.env.TELEGRAM_TOKEN!, { polling: true })
const conversations = new Map<number, Message[]>()

const agent = new Hive({
  systemPrompt: `You are a Telegram assistant. Be concise - messages should be under 4000 characters.
When you need clarification, ask one question at a time.`,
  tools: [/* your tools */],
  llm: new ClaudeProvider({ apiKey: process.env.ANTHROPIC_API_KEY })
})

bot.on('message', async (msg) => {
  const chatId = msg.chat.id
  const text = msg.text

  if (!text) return

  // Get conversation history
  const history = conversations.get(chatId) || []

  try {
    const result = await agent.run(text, { history })

    // Save history
    conversations.set(chatId, result.history)

    if (result.status === 'needs_input' && result.pendingQuestion) {
      // Send question with options as keyboard
      const options = result.pendingQuestion.options
      if (options && options.length > 0) {
        await bot.sendMessage(chatId, result.pendingQuestion.question, {
          reply_markup: {
            keyboard: options.map(opt => [{ text: opt }]),
            one_time_keyboard: true,
            resize_keyboard: true
          }
        })
      } else {
        await bot.sendMessage(chatId, result.pendingQuestion.question)
      }
    } else {
      await bot.sendMessage(chatId, result.response)
    }
  } catch (error) {
    console.error('Error:', error)
    await bot.sendMessage(chatId, 'Sorry, something went wrong.')
  }
})

// Command to clear history
bot.onText(/\/clear/, (msg) => {
  conversations.delete(msg.chat.id)
  bot.sendMessage(msg.chat.id, 'Conversation cleared.')
})
```

---

## Multi-Agent System

Complex system with specialized sub-agents:

```typescript
import { Hive, ClaudeProvider, type SubAgentConfig, type Tool } from 'hive-agent'

// Tools for research agent
const webSearchTool: Tool = {
  name: 'web_search',
  description: 'Search the web for information',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Search query' }
    },
    required: ['query']
  },
  execute: async ({ query }) => {
    // Implement with your preferred search API
    const results = await searchWeb(query as string)
    return { success: true, data: results }
  }
}

// Tools for code agent
const runCodeTool: Tool = {
  name: 'run_code',
  description: 'Execute JavaScript code',
  parameters: {
    type: 'object',
    properties: {
      code: { type: 'string', description: 'JavaScript code to run' }
    },
    required: ['code']
  },
  execute: async ({ code }) => {
    try {
      const result = eval(code as string) // Use VM2 in production!
      return { success: true, data: { output: result } }
    } catch (error) {
      return { success: false, error: String(error) }
    }
  }
}

// Sub-agents
const researchAgent: SubAgentConfig = {
  name: 'researcher',
  description: 'Research topics using web search. Use for questions requiring current information.',
  systemPrompt: `You are a research assistant. Search the web and summarize findings.
Always cite your sources. Be thorough but concise.`,
  tools: [webSearchTool]
}

const codeAgent: SubAgentConfig = {
  name: 'coder',
  description: 'Write and execute code. Use for programming tasks and calculations.',
  systemPrompt: `You are a coding assistant. Write clean, efficient code.
Test your code before providing the final answer.`,
  tools: [runCodeTool]
}

const dataAgent: SubAgentConfig = {
  name: 'data_analyst',
  description: 'Analyze data and create visualizations. Use for data-related questions.',
  systemPrompt: `You are a data analyst. Analyze data thoroughly and explain insights clearly.`,
  tools: [runCodeTool],
  maxIterations: 10  // More iterations for complex analysis
}

// Main orchestrator agent
const orchestrator = new Hive({
  systemPrompt: `You are an AI assistant that coordinates specialized agents.

Available agents:
- researcher: For questions requiring web research
- coder: For programming and code execution
- data_analyst: For data analysis tasks

Delegate tasks to appropriate agents using __task__ tool.
Combine results from multiple agents when needed.`,
  tools: [],
  agents: [researchAgent, codeAgent, dataAgent],
  llm: new ClaudeProvider({
    apiKey: process.env.ANTHROPIC_API_KEY,
    model: 'claude-sonnet-4-20250514'
  }),
  maxIterations: 20
})

// Example usage
const result = await orchestrator.run(
  'Research the current Bitcoin price and write code to calculate what $1000 would buy'
)
```

---

## Mixed Providers

Use different LLM providers for different agents:

```typescript
import { Hive, ClaudeProvider, OpenAIProvider, type SubAgentConfig } from 'hive-agent'

const claude = new ClaudeProvider({
  apiKey: process.env.ANTHROPIC_API_KEY,
  model: 'claude-sonnet-4-20250514'
})

const gpt4o = new OpenAIProvider({
  apiKey: process.env.OPENAI_API_KEY,
  model: 'gpt-4o'
})

const gpt4oMini = new OpenAIProvider({
  apiKey: process.env.OPENAI_API_KEY,
  model: 'gpt-4o-mini'
})

// Fast agent for simple tasks (cheaper, faster)
const quickHelper: SubAgentConfig = {
  name: 'quick_helper',
  description: 'Fast responses for simple questions and tasks',
  systemPrompt: 'You provide quick, concise answers.',
  tools: [],
  llm: gpt4oMini,
  maxIterations: 3
}

// Reasoning agent for complex tasks
const reasoner: SubAgentConfig = {
  name: 'reasoner',
  description: 'Deep reasoning for complex problems',
  systemPrompt: 'You think through problems step by step.',
  tools: [],
  llm: claude  // Claude for complex reasoning
}

// Creative agent
const creative: SubAgentConfig = {
  name: 'creative',
  description: 'Creative writing and brainstorming',
  systemPrompt: 'You are creative and generate unique ideas.',
  tools: [],
  llm: gpt4o  // GPT-4o for creative tasks
}

const agent = new Hive({
  systemPrompt: `You coordinate specialized agents for different tasks.
- quick_helper: Simple questions (fast, cheap)
- reasoner: Complex problems (thorough)
- creative: Creative tasks (imaginative)`,
  tools: [],
  agents: [quickHelper, reasoner, creative],
  llm: claude
})
```

---

## Interactive Workflows

Multi-step workflows with user input:

```typescript
import { Hive, ClaudeProvider, type Tool } from 'hive-agent'
import * as readline from 'readline'

const createProjectTool: Tool = {
  name: 'create_project',
  description: 'Create a new project with specified configuration',
  parameters: {
    type: 'object',
    properties: {
      name: { type: 'string' },
      type: { type: 'string', enum: ['web', 'api', 'cli'] },
      database: { type: 'string', enum: ['postgres', 'mysql', 'mongodb', 'none'] },
      auth: { type: 'boolean' }
    },
    required: ['name', 'type']
  },
  execute: async (params) => {
    // Create project based on params
    console.log('Creating project:', params)
    return { success: true, data: { message: `Project ${params.name} created!` } }
  }
}

const agent = new Hive({
  systemPrompt: `You help users create new projects.
Gather requirements by asking questions:
1. Project name
2. Project type (web/api/cli)
3. Database preference
4. Whether authentication is needed

Use __ask_user__ to gather each piece of information.
Once you have all info, use create_project tool.`,
  tools: [createProjectTool],
  llm: new ClaudeProvider({ apiKey: process.env.ANTHROPIC_API_KEY })
})

// Interactive CLI loop
async function main() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  })

  const question = (prompt: string): Promise<string> =>
    new Promise(resolve => rl.question(prompt, resolve))

  let history: Message[] = []
  let result = await agent.run('Help me create a new project', { history })

  while (true) {
    if (result.status === 'needs_input') {
      console.log('\n' + result.pendingQuestion?.question)
      if (result.pendingQuestion?.options) {
        result.pendingQuestion.options.forEach((opt, i) =>
          console.log(`  ${i + 1}. ${opt}`)
        )
      }

      const answer = await question('\nYour answer: ')
      history = result.history
      result = await agent.run(answer, { history })
    } else {
      console.log('\n' + result.response)
      break
    }
  }

  rl.close()
}

main()
```

---

## Progress Tracking

Real-time progress feedback:

```typescript
import { Hive, ClaudeProvider, ConsoleLogger, type ProgressUpdate } from 'hive-agent'

// Custom progress handler
function handleProgress(update: ProgressUpdate) {
  const icons: Record<string, string> = {
    thinking: '🤔',
    tool_start: '🔧',
    tool_end: '✅',
    sub_agent_start: '🤖',
    sub_agent_end: '✅',
    status: 'ℹ️'
  }

  const icon = icons[update.type] || '•'
  const duration = update.details?.duration ? ` (${update.details.duration}ms)` : ''

  console.log(`${icon} ${update.message}${duration}`)
}

// Logger with progress support
const logger = {
  ...new ConsoleLogger({ level: 'warn' }),
  onProgress: handleProgress
}

const agent = new Hive({
  systemPrompt: '...',
  tools: [/* tools */],
  agents: [/* sub-agents */],
  llm: new ClaudeProvider({ apiKey: process.env.ANTHROPIC_API_KEY }),
  logger
})

// Output will show:
// 🤔 Thinking...
// 🔧 Running search_web...
// ✅ search_web completed (1234ms)
// 🤖 Starting researcher...
// 🔧 [researcher] Running summarize...
// ✅ [researcher] summarize completed (567ms)
// ✅ researcher completed
```

---

## Context Management

Handle large conversations:

```typescript
import { Hive, ClaudeProvider, type Tool } from 'hive-agent'

// Tool that respects context limits
const readLargeFileTool: Tool = {
  name: 'read_large_file',
  description: 'Read a large file in chunks',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string' },
      offset: { type: 'number', description: 'Start line (default: 0)' },
      limit: { type: 'number', description: 'Max lines (default: 200)' }
    },
    required: ['path']
  },
  execute: async ({ path, offset = 0, limit = 200 }, context) => {
    const fs = await import('fs/promises')
    const content = await fs.readFile(path as string, 'utf-8')
    const lines = content.split('\n')

    const chunk = lines.slice(offset as number, (offset as number) + (limit as number))

    return {
      success: true,
      data: {
        content: chunk.join('\n'),
        totalLines: lines.length,
        offset,
        hasMore: (offset as number) + (limit as number) < lines.length,
        remainingTokens: context.remainingTokens
      }
    }
  }
}

const agent = new Hive({
  systemPrompt: `You help analyze large files.
When reading files, use offset and limit to read in chunks if the file is large.
Check remainingTokens in tool results to avoid context overflow.`,
  tools: [readLargeFileTool],
  llm: new ClaudeProvider({ apiKey: process.env.ANTHROPIC_API_KEY }),
  maxContextTokens: 50000,
  contextStrategy: 'truncate_old'  // Auto-truncate old messages when limit reached
})
```

---

## More Examples

See the `examples/` directory for complete runnable examples:

- `examples/eating-consultant/` - Nutrition tracking app with OpenFoodFacts API
