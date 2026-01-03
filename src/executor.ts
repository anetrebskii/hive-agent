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
import { ContextManager } from './context-manager.js'
import { TodoManager } from './todo.js'

const ASK_USER_TOOL_NAME = '__ask_user__'

export interface ExecutorConfig {
  systemPrompt: string
  tools: Tool[]
  llm: LLMProvider
  logger?: LogProvider
  maxIterations: number
  contextManager: ContextManager
  todoManager: TodoManager
  llmOptions?: LLMOptions

  /** AbortSignal for cancellation */
  signal?: AbortSignal

  /** Async function to check if should continue */
  shouldContinue?: () => Promise<boolean>

  /** Trace builder for execution tracing */
  traceBuilder?: import('./trace.js').TraceBuilder
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
 * Truncate and stringify data for logging
 */
function truncateForLog(data: unknown, maxLength = 500): string {
  const str = JSON.stringify(data)
  if (str.length <= maxLength) return str
  return str.slice(0, maxLength) + `... (${str.length} chars total)`
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

  // Progress: tool starting (with context for specific tools)
  let progressMessage = `Running ${tool.name}...`
  if (tool.name === '__todo__') {
    const action = (params as { action?: string }).action
    const items = (params as { items?: string[] }).items
    if (action === 'set' && items) {
      progressMessage = `Creating ${items.length} tasks...`
    } else if (action === 'complete') {
      progressMessage = `Marking task complete...`
    } else if (action === 'list') {
      progressMessage = `Checking tasks...`
    }
  } else if (tool.name === '__task__') {
    const agent = (params as { agent?: string }).agent
    progressMessage = `Delegating to ${agent}...`
  }

  logger?.onProgress?.({
    type: 'tool_start',
    message: progressMessage,
    details: { toolName: tool.name }
  })

  // Log tool execution details
  logger?.debug(`[Tool: ${tool.name}] Executing with params: ${truncateForLog(params)}`)
  logger?.debug(`[Tool: ${tool.name}] Context: conversationId=${context.conversationId}, userId=${context.userId}, remainingTokens=${context.remainingTokens}`)

  logger?.onToolCall?.(tool.name, params)

  try {
    const result = await tool.execute(params, context)
    const durationMs = Date.now() - startTime

    // Log result details
    logger?.debug(`[Tool: ${tool.name}] Completed in ${durationMs}ms, success=${result.success}`)
    if (result.success) {
      if (result.data !== undefined) {
        logger?.debug(`[Tool: ${tool.name}] Result data: ${truncateForLog(result.data)}`)
      }
    } else {
      logger?.debug(`[Tool: ${tool.name}] Error: ${result.error}`)
    }

    // Progress: tool completed (with result context)
    let completionMessage = `${tool.name} completed`
    if (tool.name === '__todo__' && result.success && result.data) {
      const data = result.data as { message?: string; currentTask?: string }
      if (data.message) {
        completionMessage = data.message
      }
    }

    logger?.onProgress?.({
      type: 'tool_end',
      message: completionMessage,
      details: { toolName: tool.name, duration: durationMs, success: result.success }
    })

    logger?.onToolResult?.(tool.name, result, durationMs)

    return { result, durationMs }
  } catch (error) {
    const durationMs = Date.now() - startTime
    const errorMessage = error instanceof Error ? error.message : String(error)
    const errorStack = error instanceof Error ? error.stack : undefined

    logger?.error(`[Tool: ${tool.name}] Exception after ${durationMs}ms: ${errorMessage}`)
    if (errorStack) {
      logger?.debug(`[Tool: ${tool.name}] Stack trace: ${errorStack}`)
    }

    const result: ToolResult = {
      success: false,
      error: errorMessage
    }

    // Progress: tool failed
    logger?.onProgress?.({
      type: 'tool_end',
      message: `${tool.name} failed`,
      details: { toolName: tool.name, duration: durationMs, success: false }
    })

    logger?.onToolResult?.(tool.name, result, durationMs)

    return { result, durationMs }
  }
}

/**
 * Check if execution should be interrupted
 */
async function checkInterruption(
  signal?: AbortSignal,
  shouldContinue?: () => Promise<boolean>
): Promise<'aborted' | 'stopped' | null> {
  // Check AbortSignal
  if (signal?.aborted) {
    return 'aborted'
  }

  // Check shouldContinue callback
  if (shouldContinue) {
    const continueExecution = await shouldContinue()
    if (!continueExecution) {
      return 'stopped'
    }
  }

  return null
}

/**
 * Build interrupted result
 */
/** Usage breakdown by model */
type UsageByModel = Record<string, {
  inputTokens: number
  outputTokens: number
  cacheCreationInputTokens?: number
  cacheReadInputTokens?: number
  calls: number
}>

function buildInterruptedResult(
  reason: 'aborted' | 'stopped' | 'max_iterations',
  iteration: number,
  messages: Message[],
  toolCallLogs: ToolCallLog[],
  thinkingBlocks: string[],
  todoManager: TodoManager,
  usage: { totalInputTokens: number; totalOutputTokens: number; totalCacheCreationTokens: number; totalCacheReadTokens: number },
  usageByModel?: UsageByModel
): AgentResult {
  const todos = todoManager.getAll()

  return {
    response: '',
    history: messages,
    toolCalls: toolCallLogs,
    thinking: thinkingBlocks.length > 0 ? thinkingBlocks : undefined,
    todos: todos.length > 0 ? todos : undefined,
    status: 'interrupted',
    interrupted: {
      reason,
      iterationsCompleted: iteration
    },
    usage: {
      totalInputTokens: usage.totalInputTokens,
      totalOutputTokens: usage.totalOutputTokens,
      cacheCreationInputTokens: usage.totalCacheCreationTokens > 0 ? usage.totalCacheCreationTokens : undefined,
      cacheReadInputTokens: usage.totalCacheReadTokens > 0 ? usage.totalCacheReadTokens : undefined
    },
    usageByModel: usageByModel && Object.keys(usageByModel).length > 0 ? usageByModel : undefined
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
    llmOptions,
    signal,
    shouldContinue,
    traceBuilder
  } = config

  const messages = [...initialMessages]
  const toolCallLogs: ToolCallLog[] = []
  const thinkingBlocks: string[] = []
  const toolSchemas = toolsToSchemas(tools)

  let totalInputTokens = 0
  let totalOutputTokens = 0
  let totalCacheCreationTokens = 0
  let totalCacheReadTokens = 0

  // Track usage by model
  const usageByModel: UsageByModel = {}
  const modelId = llm.getModelId?.() || 'unknown'

  for (let iteration = 0; iteration < maxIterations; iteration++) {
    // Check for interruption at start of each iteration
    const interruptReason = await checkInterruption(signal, shouldContinue)
    if (interruptReason) {
      logger?.onProgress?.({
        type: 'status',
        message: `Interrupted: ${interruptReason}`
      })
      return buildInterruptedResult(
        interruptReason,
        iteration,
        messages,
        toolCallLogs,
        thinkingBlocks,
        todoManager,
        { totalInputTokens, totalOutputTokens, totalCacheCreationTokens, totalCacheReadTokens },
        usageByModel
      )
    }

    logger?.onIteration?.(iteration, messages.length)

    // Progress: thinking
    logger?.onProgress?.({
      type: 'thinking',
      message: iteration === 0 ? 'Thinking...' : 'Processing...'
    })

    // Manage context (truncate if needed)
    const managedMessages = contextManager.manageContext(messages)

    // Call LLM with timing
    const llmStartTime = Date.now()
    const response = await llm.chat(
      systemPrompt,
      managedMessages,
      toolSchemas,
      llmOptions
    )
    const llmDurationMs = Date.now() - llmStartTime

    // Track usage
    if (response.usage) {
      totalInputTokens += response.usage.inputTokens
      totalOutputTokens += response.usage.outputTokens

      // Track by model
      if (!usageByModel[modelId]) {
        usageByModel[modelId] = { inputTokens: 0, outputTokens: 0, calls: 0 }
      }
      usageByModel[modelId].inputTokens += response.usage.inputTokens
      usageByModel[modelId].outputTokens += response.usage.outputTokens
      usageByModel[modelId].calls += 1

      // Record in trace
      traceBuilder?.recordLLMCall(
        modelId,
        response.usage.inputTokens,
        response.usage.outputTokens,
        llmDurationMs,
        response.cacheUsage?.cacheCreationInputTokens,
        response.cacheUsage?.cacheReadInputTokens
      )
    }
    if (response.cacheUsage) {
      totalCacheCreationTokens += response.cacheUsage.cacheCreationInputTokens
      totalCacheReadTokens += response.cacheUsage.cacheReadInputTokens

      // Track cache usage by model
      if (usageByModel[modelId]) {
        usageByModel[modelId].cacheCreationInputTokens =
          (usageByModel[modelId].cacheCreationInputTokens || 0) + response.cacheUsage.cacheCreationInputTokens
        usageByModel[modelId].cacheReadInputTokens =
          (usageByModel[modelId].cacheReadInputTokens || 0) + response.cacheUsage.cacheReadInputTokens
      }
    }

    // Collect thinking blocks
    thinkingBlocks.push(...extractThinking(response.content))

    // Add assistant message to history
    messages.push({ role: 'assistant', content: response.content })

    // Check if done (no tool use)
    if (response.stopReason !== 'tool_use') {
      const todos = todoManager.getAll()
      const incompleteTodos = todos.filter(t => t.status !== 'completed')

      // If there are incomplete todos, force the agent to continue working
      if (incompleteTodos.length > 0) {
        logger?.onProgress?.({
          type: 'status',
          message: `${incompleteTodos.length} tasks remaining, continuing...`
        })

        // Add a reminder to continue working on todos
        const reminderContent = `You have ${incompleteTodos.length} incomplete task(s) in your todo list:\n${
          incompleteTodos.map(t => `- ${t.status === 'in_progress' ? '[IN PROGRESS] ' : ''}${t.content}`).join('\n')
        }\n\nYou MUST continue working on these tasks. Use the __todo__ tool with action "complete" after finishing each task. Do not respond to the user until all tasks are completed.`

        messages.push({
          role: 'user',
          content: reminderContent
        })

        // Continue the loop instead of returning
        continue
      }

      const result: AgentResult = {
        response: extractText(response.content),
        history: messages,
        toolCalls: toolCallLogs,
        thinking: thinkingBlocks.length > 0 ? thinkingBlocks : undefined,
        todos: todos.length > 0 ? todos : undefined,
        status: 'complete',
        usage: {
          totalInputTokens,
          totalOutputTokens,
          cacheCreationInputTokens: totalCacheCreationTokens > 0 ? totalCacheCreationTokens : undefined,
          cacheReadInputTokens: totalCacheReadTokens > 0 ? totalCacheReadTokens : undefined
        },
        usageByModel: Object.keys(usageByModel).length > 0 ? usageByModel : undefined
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
      // Check for interruption between tool calls
      const toolInterruptReason = await checkInterruption(signal, shouldContinue)
      if (toolInterruptReason) {
        logger?.onProgress?.({
          type: 'status',
          message: `Interrupted between tools: ${toolInterruptReason}`
        })
        return buildInterruptedResult(
          toolInterruptReason,
          iteration,
          messages,
          toolCallLogs,
          thinkingBlocks,
          todoManager,
          { totalInputTokens, totalOutputTokens, totalCacheCreationTokens, totalCacheReadTokens },
          usageByModel
        )
      }

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
          },
          usageByModel: Object.keys(usageByModel).length > 0 ? usageByModel : undefined
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

      // Record in trace
      traceBuilder?.recordToolCall(toolUse.name, toolUse.input, result, durationMs)

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

  // Max iterations reached - return as interrupted instead of throwing
  logger?.onProgress?.({
    type: 'status',
    message: `Max iterations (${maxIterations}) reached`
  })

  return buildInterruptedResult(
    'max_iterations',
    maxIterations,
    messages,
    toolCallLogs,
    thinkingBlocks,
    todoManager,
    { totalInputTokens, totalOutputTokens, totalCacheCreationTokens, totalCacheReadTokens },
    usageByModel
  )
}
