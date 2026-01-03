/**
 * Hive Agent
 *
 * Main agent class that orchestrates tool execution, sub-agents, and context management.
 */

import type {
  HiveConfig,
  Tool,
  ToolContext,
  RunOptions,
  AgentResult,
  Message,
  SubAgentConfig,
  JSONSchema
} from './types.js'
import { ContextManager } from './context.js'
import { executeLoop } from './executor.js'
import { TodoManager, createTodoTool } from './todo.js'
import { TraceBuilder } from './trace.js'

/**
 * Create the __ask_user__ tool
 */
function createAskUserTool(): Tool {
  return {
    name: '__ask_user__',
    description: `Ask the user a clarifying question when you need more information.

Usage:
- Use when requirements are ambiguous
- Use when you need the user to make a decision
- Use when you need specific information to proceed

Examples:
- { "question": "Which database should I use?", "options": ["PostgreSQL", "MySQL", "MongoDB"] }
- { "question": "What is the target directory for the output files?" }`,
    parameters: {
      type: 'object',
      properties: {
        question: {
          type: 'string',
          description: 'The question to ask the user'
        },
        options: {
          type: 'string',
          description: 'Optional array of choices for the user'
        }
      },
      required: ['question']
    },
    execute: async () => {
      // This tool is handled specially in the executor
      return { success: true, data: 'Question sent to user' }
    }
  }
}

/**
 * Output tool name constant
 */
const OUTPUT_TOOL_NAME = '__output__'

/**
 * Create the __output__ tool for sub-agents to return structured data
 */
function createOutputTool(outputSchema: JSONSchema): Tool {
  return {
    name: OUTPUT_TOOL_NAME,
    description: `Return structured output data to the parent agent.

Use this tool when you have completed your task and want to return results.
Include a brief summary and the structured data.

IMPORTANT: Call this tool ONCE when your task is complete.`,
    parameters: {
      type: 'object',
      properties: {
        summary: {
          type: 'string',
          description: 'Brief summary of what was done (1-2 sentences)'
        },
        data: outputSchema
      },
      required: ['summary', 'data']
    } as JSONSchema,
    execute: async (params) => {
      // This tool doesn't actually execute - it's intercepted by the parent
      // The executor will capture this and return it as the result
      return { success: true, data: params }
    }
  }
}


/**
 * Build description for agent in __task__ tool
 */
function buildAgentDescription(agent: SubAgentConfig): string {
  let desc = `- **${agent.name}**: ${agent.description}`

  if (agent.inputSchema?.properties) {
    const props = agent.inputSchema.properties as Record<string, { type?: string; description?: string }>
    const paramList = Object.entries(props)
      .map(([name, schema]) => `${name}: ${schema.description || schema.type || 'any'}`)
      .join(', ')
    desc += `\n  Parameters: { ${paramList} }`
  }

  if (agent.outputSchema) {
    desc += `\n  Returns: structured data (summary + data object)`
  }

  return desc
}

/**
 * Create the __task__ tool for spawning sub-agents
 */
function createTaskTool(hive: Hive, agents: SubAgentConfig[]): Tool {
  const agentNames = agents.map(a => a.name)
  const agentDescriptions = agents.map(buildAgentDescription).join('\n')

  // Build combined properties from all agents
  // Runtime validation will check agent-specific requirements
  const combinedProperties: Record<string, { type: string; description?: string; enum?: string[] }> = {
    agent: {
      type: 'string',
      enum: agentNames,
      description: 'Which agent to spawn'
    }
  }

  // Add properties from all agent inputSchemas
  for (const agent of agents) {
    if (agent.inputSchema?.properties) {
      const props = agent.inputSchema.properties as Record<string, { type?: string; description?: string }>
      for (const [key, schema] of Object.entries(props)) {
        if (!combinedProperties[key]) {
          combinedProperties[key] = {
            type: schema.type || 'string',
            description: `[${agent.name}] ${schema.description || ''}`
          }
        }
      }
    }
  }

  // Add prompt for legacy agents
  const hasLegacyAgent = agents.some(a => !a.inputSchema)
  if (hasLegacyAgent && !combinedProperties.prompt) {
    combinedProperties.prompt = {
      type: 'string',
      description: 'The task for the agent to perform (for agents without inputSchema)'
    }
  }

  return {
    name: '__task__',
    description: `Spawn a sub-agent to handle a specific task.

Available agents:
${agentDescriptions}

Usage:
- Select the agent and provide required parameters
- Sub-agents are isolated and don't see your conversation history
- They return a summary and optional structured data`,
    parameters: {
      type: 'object',
      properties: combinedProperties,
      required: ['agent']
    } as JSONSchema,
    execute: async (params) => {
      const { agent: agentName, ...inputParams } = params as { agent: string; prompt?: string; [key: string]: unknown }

      const agentConfig = agents.find(a => a.name === agentName)
      if (!agentConfig) {
        return { success: false, error: `Unknown agent: ${agentName}` }
      }

      // Build the input message for the sub-agent
      let inputMessage: string
      if (agentConfig.inputSchema) {
        // Schema-based: pass parameters as JSON
        inputMessage = `Task parameters:\n${JSON.stringify(inputParams, null, 2)}`
      } else {
        // Legacy: use prompt directly
        inputMessage = inputParams.prompt as string || ''
      }

      // Log sub-agent start
      hive.config.logger?.info(`[Sub-Agent: ${agentName}] Starting...`)
      hive.config.logger?.debug(`[Sub-Agent: ${agentName}] Input: ${inputMessage.slice(0, 200)}${inputMessage.length > 200 ? '...' : ''}`)

      // Progress: sub-agent starting
      hive.config.logger?.onProgress?.({
        type: 'sub_agent_start',
        message: `Starting ${agentName}...`,
        details: { agentName }
      })

      try {
        // Create a wrapper logger that prefixes sub-agent logs
        const subLogger = hive.config.logger ? {
          ...hive.config.logger,
          debug: (msg: string, data?: unknown) => hive.config.logger?.debug(`[${agentName}] ${msg}`, data),
          info: (msg: string, data?: unknown) => hive.config.logger?.info(`[${agentName}] ${msg}`, data),
          warn: (msg: string, data?: unknown) => hive.config.logger?.warn(`[${agentName}] ${msg}`, data),
          error: (msg: string, data?: unknown) => hive.config.logger?.error(`[${agentName}] ${msg}`, data),
          onToolCall: (toolName: string, toolParams: unknown) => {
            hive.config.logger?.info(`[${agentName}] Tool: ${toolName}`)
            hive.config.logger?.onToolCall?.(toolName, toolParams)
          },
          onToolResult: (toolName: string, result: import('./types.js').ToolResult, durationMs: number) => {
            const status = result.success ? 'OK' : 'ERROR'
            hive.config.logger?.info(`[${agentName}] Tool ${toolName}: ${status} (${durationMs}ms)`)
            hive.config.logger?.onToolResult?.(toolName, result, durationMs)
          },
          onProgress: (update: import('./types.js').ProgressUpdate) => {
            // Prefix sub-agent progress messages
            hive.config.logger?.onProgress?.({
              ...update,
              message: `[${agentName}] ${update.message}`
            })
          }
        } : undefined

        // Use agent-specific LLM/model or fall back to parent's
        const subLlm = agentConfig.llm || hive.config.llm

        // Build sub-agent tools - include __output__ if outputSchema is defined
        const subTools = agentConfig.outputSchema
          ? [...agentConfig.tools, createOutputTool(agentConfig.outputSchema)]
          : agentConfig.tools

        // Get parent's trace builder for nested tracing
        const parentTraceBuilder = hive.getCurrentTraceBuilder()

        // Start sub-agent span in trace
        if (parentTraceBuilder) {
          parentTraceBuilder.startSubAgent(agentName)
        }

        const subHive = new Hive({
          systemPrompt: agentConfig.systemPrompt,
          tools: subTools,
          llm: subLlm,
          logger: subLogger,
          maxIterations: agentConfig.maxIterations || hive.config.maxIterations,
          thinkingMode: hive.config.thinkingMode,
          thinkingBudget: hive.config.thinkingBudget,
          disableAskUser: true,  // Sub-agents return questions as text, not via __ask_user__
          // Pass parent's trace/pricing config for nested sub-agents
          trace: hive.config.trace,
          modelPricing: hive.config.modelPricing,
          agentName: agentName
        })

        const result = await subHive.run(inputMessage, {
          // Pass trace builder for nested tracing
          _traceBuilder: parentTraceBuilder
        })

        // End sub-agent span in trace
        if (parentTraceBuilder) {
          const status = result.status === 'complete' ? 'complete' :
                         result.status === 'interrupted' ? 'interrupted' : 'error'
          parentTraceBuilder.endSubAgent(status)
        }

        // Merge sub-agent usage into parent's accumulated usage
        hive.mergeSubAgentUsage(result.usageByModel)

        // Log sub-agent completion
        hive.config.logger?.info(`[Sub-Agent: ${agentName}] Completed (${result.toolCalls.length} tool calls)`)

        // Progress: sub-agent completed
        hive.config.logger?.onProgress?.({
          type: 'sub_agent_end',
          message: `${agentName} completed`,
          details: { agentName, success: true }
        })

        if (result.status === 'needs_input') {
          return {
            success: false,
            error: 'Sub-agent needs user input',
            data: result.pendingQuestion
          }
        }

        // Check if sub-agent used __output__ tool to return structured data
        const outputCall = result.toolCalls.find(tc => tc.name === OUTPUT_TOOL_NAME)
        if (outputCall && outputCall.output?.success && outputCall.output?.data) {
          const outputData = outputCall.output.data as { summary: string; data: unknown }
          return {
            success: true,
            data: {
              summary: outputData.summary,
              data: outputData.data
            }
          }
        }

        // Legacy: return response text as summary
        return {
          success: true,
          data: {
            summary: result.response,
            data: null
          }
        }
      } catch (error) {
        // End sub-agent span with error status
        const parentTraceBuilder = hive.getCurrentTraceBuilder()
        if (parentTraceBuilder) {
          parentTraceBuilder.endSubAgent('error')
        }

        hive.config.logger?.error(`[Sub-Agent: ${agentName}] Failed: ${error instanceof Error ? error.message : String(error)}`)

        // Progress: sub-agent failed
        hive.config.logger?.onProgress?.({
          type: 'sub_agent_end',
          message: `${agentName} failed`,
          details: { agentName, success: false }
        })

        return {
          success: false,
          error: error instanceof Error ? error.message : String(error)
        }
      }
    }
  }
}

/** Usage by model type */
type UsageByModel = Record<string, {
  inputTokens: number
  outputTokens: number
  cacheCreationInputTokens?: number
  cacheReadInputTokens?: number
  calls: number
}>

/**
 * Hive Agent Class
 */
export class Hive {
  readonly config: HiveConfig
  private contextManager: ContextManager
  private tools: Tool[]
  /** Accumulated sub-agent usage (for merging into final result) */
  private subAgentUsage: UsageByModel = {}
  /** Current trace builder (set during run, used by __task__ tool) */
  private currentTraceBuilder?: TraceBuilder

  constructor(config: HiveConfig) {
    this.config = {
      maxIterations: 50,
      maxContextTokens: 100000,
      contextStrategy: 'truncate_old',
      ...config
    }

    this.contextManager = new ContextManager(
      this.config.maxContextTokens,
      this.config.contextStrategy
    )

    // Build tools list with internal tools (todo tool added per-run)
    this.tools = [...config.tools]

    // Add __ask_user__ tool unless disabled (sub-agents shouldn't use it)
    if (!config.disableAskUser) {
      this.tools.push(createAskUserTool())
    }

    // Add __task__ tool if sub-agents are defined
    if (config.agents && config.agents.length > 0) {
      this.tools.push(createTaskTool(this, config.agents))
    }
  }

  /**
   * Merge sub-agent usage into accumulated usage
   * Called by __task__ tool after sub-agent completes
   */
  mergeSubAgentUsage(usage: UsageByModel | undefined): void {
    if (!usage) return
    for (const [modelId, modelUsage] of Object.entries(usage)) {
      if (!this.subAgentUsage[modelId]) {
        this.subAgentUsage[modelId] = { inputTokens: 0, outputTokens: 0, calls: 0 }
      }
      this.subAgentUsage[modelId].inputTokens += modelUsage.inputTokens
      this.subAgentUsage[modelId].outputTokens += modelUsage.outputTokens
      this.subAgentUsage[modelId].calls += modelUsage.calls
      if (modelUsage.cacheCreationInputTokens) {
        this.subAgentUsage[modelId].cacheCreationInputTokens =
          (this.subAgentUsage[modelId].cacheCreationInputTokens || 0) + modelUsage.cacheCreationInputTokens
      }
      if (modelUsage.cacheReadInputTokens) {
        this.subAgentUsage[modelId].cacheReadInputTokens =
          (this.subAgentUsage[modelId].cacheReadInputTokens || 0) + modelUsage.cacheReadInputTokens
      }
    }
  }

  /**
   * Get accumulated sub-agent usage and reset for next run
   */
  getAndResetSubAgentUsage(): UsageByModel {
    const usage = this.subAgentUsage
    this.subAgentUsage = {}
    return usage
  }

  /**
   * Get the current trace builder (used by __task__ tool for sub-agent tracing)
   */
  getCurrentTraceBuilder(): TraceBuilder | undefined {
    return this.currentTraceBuilder
  }

  /**
   * Set the current trace builder (called at start of run)
   */
  setCurrentTraceBuilder(builder: TraceBuilder | undefined): void {
    this.currentTraceBuilder = builder
  }

  /**
   * Get tools including internal tools for a specific run
   */
  private getRunTools(todoManager: TodoManager): Tool[] {
    return [
      ...this.tools,
      createTodoTool(todoManager)
    ]
  }

  /**
   * Run the agent with a user message
   */
  async run(message: string, options: RunOptions = {}): Promise<AgentResult> {
    const { conversationId, userId, metadata, history: providedHistory, signal, shouldContinue } = options

    // Load history from repository or use provided
    let history: Message[] = []

    if (providedHistory) {
      history = providedHistory
    } else if (conversationId && this.config.repository) {
      history = await this.config.repository.getHistory(conversationId)
    }

    // Handle history with pending tool_use blocks (from interrupted executions)
    const messages: Message[] = [...history]
    const lastMessage = messages[messages.length - 1]

    // Check if last message is assistant with tool_use blocks that need results
    if (lastMessage?.role === 'assistant' && Array.isArray(lastMessage.content)) {
      const toolUseBlocks = lastMessage.content.filter(
        (block): block is import('./types.js').ToolUseBlock => block.type === 'tool_use'
      )

      if (toolUseBlocks.length > 0) {
        // Find __ask_user__ tool if present
        const askUserToolUse = toolUseBlocks.find(block => block.name === '__ask_user__')

        // Build tool_results for all tool_use blocks
        const toolResults: import('./types.js').ToolResultBlock[] = toolUseBlocks.map(toolUse => {
          if (toolUse.name === '__ask_user__') {
            // User's message is the answer to __ask_user__
            return {
              type: 'tool_result' as const,
              tool_use_id: toolUse.id,
              content: JSON.stringify({ success: true, data: { answer: message } })
            }
          } else {
            // Other tools were interrupted - mark as cancelled
            return {
              type: 'tool_result' as const,
              tool_use_id: toolUse.id,
              content: JSON.stringify({ success: false, error: 'Operation cancelled - execution was interrupted' }),
              is_error: true
            }
          }
        })

        // If there was an __ask_user__, the user's message is already the answer
        // Otherwise, we need to include both the tool_results and the user message
        if (askUserToolUse) {
          messages.push({ role: 'user', content: toolResults })
        } else {
          // Combine tool_results and user message in a single user message
          // (API doesn't allow consecutive user messages)
          messages.push({
            role: 'user',
            content: [
              ...toolResults,
              { type: 'text' as const, text: message }
            ]
          })
        }
      } else {
        // No tool_use blocks, normal user message
        messages.push({ role: 'user', content: message })
      }
    } else {
      // Normal user message
      messages.push({ role: 'user', content: message })
    }

    // Create todo manager for this run
    const todoManager = new TodoManager()

    // Create tool context
    const toolContext: ToolContext = {
      remainingTokens: this.contextManager.getRemainingTokens(),
      conversationId,
      userId,
      metadata
    }

    // Create or use existing trace builder
    // If _traceBuilder is passed (from parent agent), use it
    // Otherwise create a new one if trace provider is configured
    const traceBuilder = options._traceBuilder || (
      this.config.trace
        ? new TraceBuilder(
            this.config.agentName || 'agent',
            this.config.trace,
            this.config.modelPricing
          )
        : undefined
    )

    // Store trace builder for __task__ tool to access
    this.setCurrentTraceBuilder(traceBuilder)

    // Execute the agent loop
    const result = await executeLoop(
      {
        systemPrompt: this.config.systemPrompt,
        tools: this.getRunTools(todoManager),
        llm: this.config.llm,
        logger: this.config.logger,
        maxIterations: this.config.maxIterations!,
        contextManager: this.contextManager,
        todoManager,
        llmOptions: {
          thinkingMode: this.config.thinkingMode,
          thinkingBudget: this.config.thinkingBudget
        },
        signal,
        shouldContinue,
        traceBuilder
      },
      messages,
      toolContext
    )

    // Save history to repository
    if (conversationId && this.config.repository) {
      await this.config.repository.saveHistory(conversationId, result.history)
    }

    // Merge sub-agent usage into the result
    const subAgentUsage = this.getAndResetSubAgentUsage()
    if (Object.keys(subAgentUsage).length > 0) {
      // Merge sub-agent usage with executor's usageByModel
      const mergedUsage = { ...result.usageByModel }
      for (const [modelId, modelUsage] of Object.entries(subAgentUsage)) {
        if (!mergedUsage[modelId]) {
          mergedUsage[modelId] = { inputTokens: 0, outputTokens: 0, calls: 0 }
        }
        mergedUsage[modelId].inputTokens += modelUsage.inputTokens
        mergedUsage[modelId].outputTokens += modelUsage.outputTokens
        mergedUsage[modelId].calls += modelUsage.calls
        if (modelUsage.cacheCreationInputTokens) {
          mergedUsage[modelId].cacheCreationInputTokens =
            (mergedUsage[modelId].cacheCreationInputTokens || 0) + modelUsage.cacheCreationInputTokens
        }
        if (modelUsage.cacheReadInputTokens) {
          mergedUsage[modelId].cacheReadInputTokens =
            (mergedUsage[modelId].cacheReadInputTokens || 0) + modelUsage.cacheReadInputTokens
        }
      }
      result.usageByModel = mergedUsage
    }

    // End trace and attach to result (only for root agent, not sub-agents)
    if (traceBuilder && !options._traceBuilder) {
      const status = result.status === 'complete' ? 'complete' :
                     result.status === 'interrupted' ? 'interrupted' : 'complete'
      result.trace = traceBuilder.endTrace(status)
    }

    return result
  }
}
