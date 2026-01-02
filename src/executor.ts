/**
 * Executor - Tool Execution Loop
 *
 * Core execution loop that runs tools and handles agent responses.
 */

import type {
  Message,
  Tool,
  ToolSchema,
  ToolResult,
  ToolCallLog,
  ToolContext,
  ContentBlock,
  ToolUseBlock,
  ToolResultBlock,
  LLMProvider,
  LLMOptions,
  LogProvider,
  AgentResult,
  PendingQuestion
} from './types.js'
import { ContextManager } from './context.js'
import { TodoManager } from './todo.js'
import { ReviewManager } from './review.js'

const ASK_USER_TOOL_NAME = '__ask_user__'

export interface ExecutorConfig {
  systemPrompt: string
  tools: Tool[]
  llm: LLMProvider
  logger?: LogProvider
  maxIterations: number
  contextManager: ContextManager
  todoManager: TodoManager
  reviewManager?: ReviewManager
  llmOptions?: LLMOptions
}

/**
 * Extract text from content blocks
 */
function extractText(content: ContentBlock[]): string {
  return content
    .filter((block): block is { type: 'text'; text: string } => block.type === 'text')
    .map(block => block.text)
    .join('\n')
}

/**
 * Extract thinking blocks
 */
function extractThinking(content: ContentBlock[]): string[] {
  return content
    .filter((block): block is { type: 'thinking'; thinking: string } => block.type === 'thinking')
    .map(block => block.thinking)
}

/**
 * Convert tools to schemas for LLM
 */
function toolsToSchemas(tools: Tool[]): ToolSchema[] {
  return tools.map(tool => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.parameters
  }))
}

/**
 * Execute a single tool
 */
async function executeTool(
  tool: Tool,
  params: Record<string, unknown>,
  context: ToolContext,
  logger?: LogProvider
): Promise<{ result: ToolResult; durationMs: number }> {
  const startTime = Date.now()

  logger?.onToolCall?.(tool.name, params)

  try {
    const result = await tool.execute(params, context)
    const durationMs = Date.now() - startTime

    logger?.onToolResult?.(tool.name, result, durationMs)

    return { result, durationMs }
  } catch (error) {
    const durationMs = Date.now() - startTime
    const result: ToolResult = {
      success: false,
      error: error instanceof Error ? error.message : String(error)
    }

    logger?.onToolResult?.(tool.name, result, durationMs)

    return { result, durationMs }
  }
}

/**
 * Main execution loop
 */
export async function executeLoop(
  config: ExecutorConfig,
  initialMessages: Message[],
  toolContext: ToolContext
): Promise<AgentResult> {
  const {
    systemPrompt,
    tools,
    llm,
    logger,
    maxIterations,
    contextManager,
    todoManager,
    reviewManager,
    llmOptions
  } = config

  const messages = [...initialMessages]
  const toolCallLogs: ToolCallLog[] = []
  const thinkingBlocks: string[] = []
  const toolSchemas = toolsToSchemas(tools)

  let totalInputTokens = 0
  let totalOutputTokens = 0
  let totalCacheCreationTokens = 0
  let totalCacheReadTokens = 0

  for (let iteration = 0; iteration < maxIterations; iteration++) {
    logger?.onIteration?.(iteration, messages.length)

    // Manage context (truncate if needed)
    const managedMessages = contextManager.manageContext(messages)

    // Call LLM
    const response = await llm.chat(
      systemPrompt,
      managedMessages,
      toolSchemas,
      llmOptions
    )

    // Track usage
    if (response.usage) {
      totalInputTokens += response.usage.inputTokens
      totalOutputTokens += response.usage.outputTokens
    }
    if (response.cacheUsage) {
      totalCacheCreationTokens += response.cacheUsage.cacheCreationInputTokens
      totalCacheReadTokens += response.cacheUsage.cacheReadInputTokens
    }

    // Collect thinking blocks
    thinkingBlocks.push(...extractThinking(response.content))

    // Add assistant message to history
    messages.push({ role: 'assistant', content: response.content })

    // Check if done (no tool use)
    if (response.stopReason !== 'tool_use') {
      const todos = todoManager.getAll()
      const review = reviewManager?.getCurrentReview()
      const result: AgentResult = {
        response: extractText(response.content),
        history: messages,
        toolCalls: toolCallLogs,
        thinking: thinkingBlocks.length > 0 ? thinkingBlocks : undefined,
        todos: todos.length > 0 ? todos : undefined,
        review,
        status: 'complete',
        usage: {
          totalInputTokens,
          totalOutputTokens,
          cacheCreationInputTokens: totalCacheCreationTokens > 0 ? totalCacheCreationTokens : undefined,
          cacheReadInputTokens: totalCacheReadTokens > 0 ? totalCacheReadTokens : undefined
        }
      }

      logger?.onComplete?.(result)
      return result
    }

    // Execute tool calls
    const toolUseBlocks = response.content.filter(
      (block): block is ToolUseBlock => block.type === 'tool_use'
    )

    const toolResults: ToolResultBlock[] = []

    for (const toolUse of toolUseBlocks) {
      // Handle ask_user tool specially
      if (toolUse.name === ASK_USER_TOOL_NAME) {
        const pendingQuestion: PendingQuestion = {
          question: (toolUse.input as { question: string }).question,
          options: (toolUse.input as { options?: string[] }).options
        }

        const todos = todoManager.getAll()
        return {
          response: '',
          history: messages,
          toolCalls: toolCallLogs,
          thinking: thinkingBlocks.length > 0 ? thinkingBlocks : undefined,
          todos: todos.length > 0 ? todos : undefined,
          pendingQuestion,
          status: 'needs_input',
          usage: {
            totalInputTokens,
            totalOutputTokens,
            cacheCreationInputTokens: totalCacheCreationTokens > 0 ? totalCacheCreationTokens : undefined,
            cacheReadInputTokens: totalCacheReadTokens > 0 ? totalCacheReadTokens : undefined
          }
        }
      }

      // Find and execute the tool
      const tool = tools.find(t => t.name === toolUse.name)

      if (!tool) {
        toolResults.push({
          type: 'tool_result',
          tool_use_id: toolUse.id,
          content: JSON.stringify({ success: false, error: `Unknown tool: ${toolUse.name}` }),
          is_error: true
        })
        continue
      }

      const { result, durationMs } = await executeTool(
        tool,
        toolUse.input,
        toolContext,
        logger
      )

      toolCallLogs.push({
        name: toolUse.name,
        input: toolUse.input,
        output: result,
        durationMs
      })

      toolResults.push({
        type: 'tool_result',
        tool_use_id: toolUse.id,
        content: JSON.stringify(result),
        is_error: !result.success
      })
    }

    // Add tool results as user message
    messages.push({ role: 'user', content: toolResults })
  }

  throw new Error(`Max iterations (${maxIterations}) reached`)
}
