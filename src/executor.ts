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
  PendingQuestion,
  ProgressUpdate
} from './types.js'
import { ContextManager } from './context-manager.js'
import { TaskManager } from './tools/tasks.js'
import { calculateCost } from './trace/pricing.js'
import {
  type Activity,
  describeActivity,
  classifyTool,
  classifyShellCommand
} from './activity.js'

const ASK_USER_TOOL_NAME = '__ask_user__'
const SKILL_TOOL_NAME = '__skill__'
const SUB_AGENT_TOOL_NAME = '__sub_agent__'
const TOOL_SEARCH_NAME = '__tool_search__'

export interface ExecutorConfig {
  systemPrompt: string
  tools: Tool[]
  llm: LLMProvider
  logger?: LogProvider
  maxIterations: number
  contextManager: ContextManager
  taskManager: TaskManager
  llmOptions?: LLMOptions

  /** Orchestration instructions injected on first __sub_agent__ call (lazy-loaded) */
  orchestrationPrompt?: string

  /** Tools available for deferred loading via __tool_search__ */
  deferredTools?: Tool[]

  /** AbortSignal for cancellation */
  signal?: AbortSignal

  /** Async function to check if should continue */
  shouldContinue?: () => Promise<boolean>

  /** Trace builder for execution tracing */
  traceBuilder?: import('./trace.js').TraceBuilder

  /** Nesting depth for progress events (0=root, 1=sub-agent, etc.) */
  depth?: number
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

let nextEventId = 0
function generateEventId(): string {
  return `evt_${Date.now()}_${nextEventId++}`
}

/**
 * Emit a progress event with activity and label auto-populated.
 */
function emitProgress(
  logger: LogProvider | undefined,
  update: ProgressUpdate & { activity?: Activity }
): void {
  if (!logger?.onProgress) return
  const enriched: ProgressUpdate = { ...update }
  if (enriched.activity) {
    enriched.label = describeActivity(enriched.activity)
  }
  logger.onProgress(enriched)
}


/**
 * Execute a single tool
 */
async function executeTool(
  tool: Tool,
  params: Record<string, unknown>,
  context: ToolContext,
  logger?: LogProvider,
  depth?: number
): Promise<{ result: ToolResult; durationMs: number }> {
  const startTime = Date.now()

  // Build activity and progress message for tool start
  let activity: Activity | undefined
  let progressMessage = `Running ${tool.name}...`

  if (tool.name === '__shell__') {
    const command = (params as { command?: string }).command
    if (command) {
      activity = classifyShellCommand(command)
      const truncated = command.length > 80 ? command.slice(0, 80) + '...' : command
      progressMessage = `$ ${truncated}`
    }
  } else {
    activity = classifyTool(tool.name, params)
    // Keep backward-compatible messages
    if (tool.name === 'TaskCreate') {
      const subject = (params as { subject?: string }).subject
      progressMessage = subject ? `Creating task: "${subject}"...` : 'Creating task...'
    } else if (tool.name === 'TaskUpdate') {
      const status = (params as { status?: string }).status
      if (status === 'completed') {
        progressMessage = 'Marking task complete...'
      } else if (status === 'in_progress') {
        progressMessage = 'Starting task...'
      } else if (status === 'deleted') {
        progressMessage = 'Deleting task...'
      } else {
        progressMessage = 'Updating task...'
      }
    } else if (tool.name === 'TaskList') {
      progressMessage = 'Checking tasks...'
    } else if (tool.name === 'TaskGet') {
      progressMessage = 'Getting task details...'
    } else if (tool.name === '__sub_agent__') {
      const agent = (params as { agent?: string }).agent
      progressMessage = `Delegating to ${agent}...`
    }
  }

  const toolEventId = generateEventId()
  emitProgress(logger, {
    type: 'tool_start',
    message: progressMessage,
    activity,
    id: toolEventId,
    depth: depth ?? 0,
    details: { toolName: tool.name }
  })

  // Log tool execution details
  logger?.debug(`[Tool: ${tool.name}] Executing with params: ${truncateForLog(params)}`)
  logger?.debug(`[Tool: ${tool.name}] Context: conversationId=${context.conversationId}, userId=${context.userId}, remainingTokens=${context.remainingTokens}`)

  const toolMeta = activity ? { activity, label: describeActivity(activity) } : undefined
  logger?.onToolCall?.(tool.name, params, toolMeta)

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
      logger?.warn(`[Tool: ${tool.name}] Error: ${result.error}`)
      if (result.data !== undefined) {
        logger?.warn(`[Tool: ${tool.name}] Details: ${truncateForLog(result.data, 1000)}`)
      }
    }

    // Progress: tool completed (with result context)
    let completionMessage = `${tool.name} completed`
    if (!result.success) {
      completionMessage = `${tool.name} failed: ${result.error}`
    } else if (tool.name === '__shell__') {
      const command = (params as { command?: string }).command
      if (command) {
        const truncated = command.length > 80 ? command.slice(0, 80) + '...' : command
        completionMessage = `$ ${truncated}`
      }
    } else {
      const isTaskTool = ['TaskCreate', 'TaskUpdate', 'TaskGet', 'TaskList'].includes(tool.name)
      if (isTaskTool && result.data) {
        const data = result.data as { message?: string }
        if (data.message) {
          completionMessage = data.message
        }
      }
    }

    emitProgress(logger, {
      type: 'tool_end',
      message: completionMessage,
      activity,
      id: toolEventId,
      depth: depth ?? 0,
      details: { toolName: tool.name, duration: durationMs, success: result.success }
    })

    logger?.onToolResult?.(tool.name, result, durationMs, toolMeta)

    return { result, durationMs }
  } catch (error) {
    const durationMs = Date.now() - startTime
    const errorMessage = error instanceof Error ? error.message : String(error)
    const errorStack = error instanceof Error ? error.stack : undefined

    logger?.error(`[Tool: ${tool.name}] Exception after ${durationMs}ms: ${errorMessage}`)
    if (errorStack) {
      logger?.error(`[Tool: ${tool.name}] Stack trace: ${errorStack}`)
    }

    const result: ToolResult = {
      success: false,
      error: errorMessage
    }

    // Progress: tool failed
    emitProgress(logger, {
      type: 'tool_end',
      message: `${tool.name} failed`,
      activity,
      id: toolEventId,
      depth: depth ?? 0,
      details: { toolName: tool.name, duration: durationMs, success: false }
    })

    logger?.onToolResult?.(tool.name, result, durationMs, toolMeta)

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
function buildInterruptedResult(
  reason: 'aborted' | 'stopped' | 'max_iterations',
  iteration: number,
  messages: Message[],
  toolCallLogs: ToolCallLog[],
  thinkingBlocks: string[],
  taskManager: TaskManager
): AgentResult {
  const tasks = taskManager.getAll()

  return {
    response: '',
    history: messages,
    toolCalls: toolCallLogs,
    thinking: thinkingBlocks.length > 0 ? thinkingBlocks : undefined,
    tasks: tasks.length > 0 ? tasks : undefined,
    status: 'interrupted',
    interrupted: {
      reason,
      iterationsCompleted: iteration
    }
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
    tools: initialTools,
    llm,
    logger,
    maxIterations,
    contextManager,
    taskManager,
    llmOptions,
    orchestrationPrompt,
    deferredTools,
    signal,
    shouldContinue,
    traceBuilder,
    depth: executorDepth = 0
  } = config

  const messages = [...initialMessages]
  const toolCallLogs: ToolCallLog[] = []
  const thinkingBlocks: string[] = []
  const tools = [...initialTools]
  let toolSchemas = toolsToSchemas(tools)
  const modelId = llm.getModelId?.() || 'unknown'
  let cumulativeInputTokens = 0
  let cumulativeOutputTokens = 0
  const executorStartTime = Date.now()

  let activatedSkill: { name: string; prompt: string } | null = null
  let orchestrationInjected = !orchestrationPrompt // skip if no prompt

  // Deferred tool loading: track which tools have been loaded via __tool_search__
  const deferredToolMap = new Map((deferredTools || []).map(t => [t.name, t]))

  // Pre-promote deferred tools that were already loaded earlier in this conversation.
  // Walk history in order and replay __tool_search__ selections so the tools block
  // matches the state at the end of the previous turn — otherwise the prompt cache
  // misses on the history prefix and the model re-emits __tool_search__.
  if (deferredToolMap.size > 0) {
    const promoted = new Set<string>()
    const promote = (name: string) => {
      if (promoted.has(name)) return
      const tool = deferredToolMap.get(name)
      if (!tool) return
      if (toolSchemas.some(s => s.name === name)) return
      tools.push(tool)
      toolSchemas = [...toolSchemas, { name: tool.name, description: tool.description, input_schema: tool.parameters }]
      promoted.add(name)
    }
    for (const msg of initialMessages) {
      if (!Array.isArray(msg.content)) continue
      for (const block of msg.content) {
        if (block.type !== 'tool_use') continue
        if (block.name === TOOL_SEARCH_NAME) {
          const query = typeof block.input?.query === 'string' ? block.input.query : ''
          const match = query.match(/^select:(.+)$/i)
          if (!match) continue
          for (const name of match[1].split(',').map(s => s.trim())) {
            promote(name)
          }
        } else {
          // Tool was called directly without a prior search in history (e.g. evicted
          // from a pruned older message). Promote anyway so it stays executable.
          promote(block.name)
        }
      }
    }
  }

  for (let iteration = 0; iteration < maxIterations; iteration++) {
    // Check for interruption at start of each iteration
    const interruptReason = await checkInterruption(signal, shouldContinue)
    if (interruptReason) {
      emitProgress(logger, {
        type: 'status',
        message: `Interrupted: ${interruptReason}`,
        activity: { type: 'agent:interrupted', reason: interruptReason },
        depth: executorDepth
      })
      return buildInterruptedResult(
        interruptReason,
        iteration,
        messages,
        toolCallLogs,
        thinkingBlocks,
        taskManager
      )
    }

    logger?.onIteration?.(iteration, messages.length)

    // Progress: thinking
    emitProgress(logger, {
      type: 'thinking',
      message: iteration === 0 ? 'Thinking...' : 'Processing...',
      activity: { type: 'agent:thinking' },
      depth: executorDepth
    })

    // Manage context (truncate/summarize if needed)
    const managedMessages = await contextManager.manageContext(messages)

    // Call LLM with timing
    const llmStartTime = Date.now()
    let response
    try {
      response = await llm.chat(
        systemPrompt,
        managedMessages,
        toolSchemas,
        llmOptions
      )
    } catch (error) {
      const llmDurationMs = Date.now() - llmStartTime
      const errorMessage = error instanceof Error ? error.message : String(error)
      logger?.error(`[LLM] Failed after ${llmDurationMs}ms: ${errorMessage}`)

      const tasks = taskManager.getAll()
      return {
        response: '',
        history: messages,
        toolCalls: toolCallLogs,
        thinking: thinkingBlocks.length > 0 ? thinkingBlocks : undefined,
        tasks: tasks.length > 0 ? tasks : undefined,
        status: 'error' as const,
        error: errorMessage
      }
    }
    const llmDurationMs = Date.now() - llmStartTime

    // Use the model id reported on the response when present (e.g. a
    // FallbackProvider that fell through to a backup vendor) so cost
    // accounting follows the provider that actually served the call.
    const callModelId = response.modelId ?? modelId

    // Record usage in trace
    if (response.usage) {
      traceBuilder?.recordLLMCall(
        callModelId,
        response.usage.inputTokens,
        response.usage.outputTokens,
        llmDurationMs,
        {
          cacheCreationTokens: response.cacheUsage?.cacheCreationInputTokens,
          cacheReadTokens: response.cacheUsage?.cacheReadInputTokens,
          systemPrompt,
          messages: managedMessages,
          response: response.content
        }
      )
    }

    // Collect thinking blocks
    thinkingBlocks.push(...extractThinking(response.content))

    // Emit usage event with cumulative token counts and cost
    if (response.usage) {
      cumulativeInputTokens += response.usage.inputTokens
      cumulativeOutputTokens += response.usage.outputTokens

      const callCost = calculateCost(
        callModelId,
        response.usage.inputTokens,
        response.usage.outputTokens,
        response.cacheUsage?.cacheCreationInputTokens,
        response.cacheUsage?.cacheReadInputTokens
      )
      const cumulativeCost = traceBuilder?.getCumulativeCost() ?? callCost

      emitProgress(logger, {
        type: 'usage',
        message: `Tokens: ${cumulativeInputTokens} in / ${cumulativeOutputTokens} out | Cost: $${cumulativeCost.toFixed(4)}`,
        depth: executorDepth,
        details: {
          usage: {
            inputTokens: cumulativeInputTokens,
            outputTokens: cumulativeOutputTokens,
            elapsed: Date.now() - executorStartTime,
            callCost,
            cumulativeCost,
            modelId: callModelId
          }
        }
      })
    }

    const assistantContent = response.content

    // Add assistant message to history
    messages.push({ role: 'assistant', content: assistantContent })

    // Emit AI text blocks as progress events (only when alongside tool calls —
    // final response text is returned via result.response, not as a progress event)
    if (response.stopReason === 'tool_use') {
      const textBlocks = assistantContent.filter(
        (b): b is { type: 'text'; text: string } => b.type === 'text'
      )
      for (const block of textBlocks) {
        if (block.text.trim()) {
          emitProgress(logger, {
            type: 'text',
            message: block.text.length > 120 ? block.text.slice(0, 120) + '...' : block.text,
            activity: { type: 'agent:responding' },
            depth: executorDepth,
            details: { text: block.text }
          })
        }
      }
    }

    // Check if done (no tool use)
    if (response.stopReason !== 'tool_use') {
      const tasks = taskManager.getAll()
      const incompleteTasks = tasks.filter(t => t.status !== 'completed')

      // If there are incomplete tasks, force the agent to continue working
      if (incompleteTasks.length > 0) {
        emitProgress(logger, {
          type: 'status',
          message: `${incompleteTasks.length} tasks remaining, continuing...`,
          depth: executorDepth
        })

        // Add a reminder to continue working on tasks
        const reminderContent = `You have ${incompleteTasks.length} incomplete task(s) in your task list:\n${
          incompleteTasks.map(t => `- ${t.status === 'in_progress' ? '[IN PROGRESS] ' : ''}${t.subject}`).join('\n')
        }\n\nYou MUST continue working on these tasks. Use the TaskUpdate tool with status "completed" after finishing each task. Do not respond to the user until all tasks are completed.`

        messages.push({
          role: 'user',
          content: reminderContent
        })

        // Continue the loop instead of returning
        continue
      }

      const result: AgentResult = {
        response: extractText(assistantContent),
        history: messages,
        toolCalls: toolCallLogs,
        thinking: thinkingBlocks.length > 0 ? thinkingBlocks : undefined,
        tasks: tasks.length > 0 ? tasks : undefined,
        status: 'complete'
      }

      logger?.onComplete?.(result)
      return result
    }

    // Execute tool calls
    const toolUseBlocks = assistantContent.filter(
      (block): block is ToolUseBlock => block.type === 'tool_use'
    )

    const toolResults: ToolResultBlock[] = []

    for (const toolUse of toolUseBlocks) {
      // Check for interruption between tool calls
      const toolInterruptReason = await checkInterruption(signal, shouldContinue)
      if (toolInterruptReason) {
        emitProgress(logger, {
          type: 'status',
          message: `Interrupted between tools: ${toolInterruptReason}`,
          activity: { type: 'agent:interrupted', reason: toolInterruptReason },
          depth: executorDepth
        })
        return buildInterruptedResult(
          toolInterruptReason,
          iteration,
          messages,
          toolCallLogs,
          thinkingBlocks,
          taskManager
        )
      }

      // Find the tool — reject hallucinated tool calls early
      let tool = tools.find(t => t.name === toolUse.name)

      // Deferred tool called directly without a prior __tool_search__ (some models,
      // e.g. Gemini, skip the search-first protocol). Promote it and run it instead
      // of failing — matches the history pre-promotion courtesy.
      if (!tool) {
        const deferred = deferredToolMap.get(toolUse.name)
        if (deferred) {
          tool = deferred
          if (!toolSchemas.some(s => s.name === deferred.name)) {
            tools.push(deferred)
            toolSchemas = [...toolSchemas, { name: deferred.name, description: deferred.description, input_schema: deferred.parameters }]
          }
        }
      }

      if (!tool) {
        const error = deferredToolMap.size > 0
          ? `Unknown tool: ${toolUse.name}. If you expected this tool to exist, find it with ${TOOL_SEARCH_NAME} and try again.`
          : `Unknown tool: ${toolUse.name}`
        toolResults.push({
          type: 'tool_result',
          tool_use_id: toolUse.id,
          content: JSON.stringify({ success: false, error }),
          is_error: true
        })
        continue
      }

      // Handle ask_user tool specially — pause execution and return to caller
      if (toolUse.name === ASK_USER_TOOL_NAME) {
        const input = toolUse.input as {
          questions?: import('./types.js').EnhancedQuestion[]
        }

        // Build pendingQuestion from questions array
        const questions = input.questions && Array.isArray(input.questions) && input.questions.length > 0
          ? input.questions
          : [{ question: 'The assistant needs more information. Please provide additional details.' }]

        const pendingQuestion: PendingQuestion = { questions }

        const tasks = taskManager.getAll()
        return {
          response: '',
          history: messages,
          toolCalls: toolCallLogs,
          thinking: thinkingBlocks.length > 0 ? thinkingBlocks : undefined,
          tasks: tasks.length > 0 ? tasks : undefined,
          pendingQuestion,
          status: 'needs_input'
        }
      }

      const { result, durationMs } = await executeTool(
        tool,
        toolUse.input,
        toolContext,
        logger,
        executorDepth
      )

      toolCallLogs.push({
        name: toolUse.name,
        input: toolUse.input,
        output: result,
        durationMs
      })

      // Record in trace
      traceBuilder?.recordToolCall(toolUse.name, toolUse.input, result, durationMs)

      // If a sub-agent needs user input, propagate needs_input immediately
      // We add the __sub_agent__ tool result to history, then synthesize an __ask_user__
      // tool call so the existing resume logic in agent.ts works correctly
      if (toolUse.name === '__sub_agent__' && !result.success && result.error === 'Sub-agent needs user input' && result.data) {
        const subAgentData = result.data as { questions?: import('./types.js').EnhancedQuestion[] }
        if (subAgentData.questions && Array.isArray(subAgentData.questions) && subAgentData.questions.length > 0) {
          // Add the __sub_agent__ tool result to close the pending tool_use
          toolResults.push({
            type: 'tool_result',
            tool_use_id: toolUse.id,
            content: JSON.stringify(result),
            is_error: true
          })
          messages.push({ role: 'user', content: toolResults })

          // Synthesize an __ask_user__ tool call so resume logic works
          const syntheticAskUserId = `synthetic_ask_user_${Date.now()}`
          messages.push({
            role: 'assistant',
            content: [{
              type: 'tool_use',
              id: syntheticAskUserId,
              name: ASK_USER_TOOL_NAME,
              input: { questions: subAgentData.questions }
            }]
          })

          const pendingQuestion: PendingQuestion = { questions: subAgentData.questions }
          const tasks = taskManager.getAll()
          return {
            response: '',
            history: messages,
            toolCalls: toolCallLogs,
            thinking: thinkingBlocks.length > 0 ? thinkingBlocks : undefined,
            tasks: tasks.length > 0 ? tasks : undefined,
            pendingQuestion,
            status: 'needs_input'
          }
        }
      }

      // Detect tool search - load deferred tools for next iteration
      if (toolUse.name === TOOL_SEARCH_NAME && result.success && result.data) {
        const tsr = result.data as { __toolSearchResult?: boolean; loadedTools?: string[] }
        if (tsr.__toolSearchResult && tsr.loadedTools) {
          for (const name of tsr.loadedTools) {
            const tool = deferredToolMap.get(name)
            if (tool && !toolSchemas.some(s => s.name === name)) {
              toolSchemas = [...toolSchemas, { name: tool.name, description: tool.description, input_schema: tool.parameters }]
              // Also add to tools array so executeTool can find it
              tools.push(tool)
            }
          }
        }
      }

      // Detect skill activation
      let toolResult = result
      if (toolUse.name === SKILL_TOOL_NAME && result.success && result.data) {
        const sd = result.data as { __skillActivation?: boolean; skillName?: string; skillPrompt?: string }
        if (sd.__skillActivation) {
          activatedSkill = { name: sd.skillName!, prompt: sd.skillPrompt! }
          toolResult = { success: true, data: { message: `Skill "${sd.skillName}" activated. Follow the instructions below.` } }
        }
      }

      toolResults.push({
        type: 'tool_result',
        tool_use_id: toolUse.id,
        content: JSON.stringify(toolResult),
        is_error: !toolResult.success
      })
    }

    // Add tool results as user message
    messages.push({ role: 'user', content: toolResults })

    // Inject skill prompt if activated during this iteration
    if (activatedSkill) {
      messages.push({
        role: 'assistant',
        content: `Skill "${activatedSkill.name}" loaded. Following its instructions now.`
      })
      messages.push({
        role: 'user',
        content: `<skill name="${activatedSkill.name}">\n${activatedSkill.prompt}\n</skill>`
      })
      activatedSkill = null
    }

    // Inject orchestration instructions on first __sub_agent__ call
    if (!orchestrationInjected && toolCallLogs.some(tc => tc.name === SUB_AGENT_TOOL_NAME)) {
      orchestrationInjected = true
      messages.push({
        role: 'assistant',
        content: 'Loading orchestration workflow instructions.'
      })
      messages.push({
        role: 'user',
        content: `<system-reminder>\n${orchestrationPrompt}\n</system-reminder>`
      })
    }
  }

  // Max iterations reached - return as interrupted instead of throwing
  emitProgress(logger, {
    type: 'status',
    message: `Max iterations (${maxIterations}) reached`,
    activity: { type: 'agent:interrupted', reason: 'max_iterations' },
    depth: executorDepth
  })

  return buildInterruptedResult(
    'max_iterations',
    maxIterations,
    messages,
    toolCallLogs,
    thinkingBlocks,
    taskManager
  )
}
