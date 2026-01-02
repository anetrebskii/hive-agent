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
import { buildAgentListSection } from './prompt.js'
import { TodoManager, createTodoTool } from './todo.js'
import { ReviewManager, createReviewTool } from './review.js'

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
 * Create the __task__ tool for spawning sub-agents
 */
function createTaskTool(hive: Hive, agents: SubAgentConfig[]): Tool {
  const agentNames = agents.map(a => a.name)
  const agentList = buildAgentListSection(agents)

  return {
    name: '__task__',
    description: `Spawn a sub-agent to handle a specific task.
${agentList}

Usage:
- Use sub-agents for specialized tasks
- Provide a clear, specific prompt for the task
- The sub-agent will return its result`,
    parameters: {
      type: 'object',
      properties: {
        agent: {
          type: 'string',
          enum: agentNames,
          description: 'Which agent to spawn'
        },
        prompt: {
          type: 'string',
          description: 'The task for the agent to perform'
        }
      },
      required: ['agent', 'prompt']
    } as JSONSchema,
    execute: async (params) => {
      const { agent: agentName, prompt } = params as { agent: string; prompt: string }

      const agentConfig = agents.find(a => a.name === agentName)
      if (!agentConfig) {
        return { success: false, error: `Unknown agent: ${agentName}` }
      }

      // Log sub-agent start
      hive.config.logger?.info(`[Sub-Agent: ${agentName}] Starting...`)
      hive.config.logger?.info(`[Sub-Agent: ${agentName}] Task: ${prompt.slice(0, 100)}${prompt.length > 100 ? '...' : ''}`)

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
          onToolCall: (toolName: string, params: unknown) => {
            hive.config.logger?.info(`[${agentName}] Tool: ${toolName}`)
            hive.config.logger?.onToolCall?.(toolName, params)
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

        const subHive = new Hive({
          systemPrompt: agentConfig.systemPrompt,
          tools: agentConfig.tools,
          llm: subLlm,
          logger: subLogger,
          maxIterations: agentConfig.maxIterations || hive.config.maxIterations,
          thinkingMode: hive.config.thinkingMode,
          thinkingBudget: hive.config.thinkingBudget,
          disableAskUser: true  // Sub-agents return questions as text, not via __ask_user__
        })

        const result = await subHive.run(prompt)

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

        return { success: true, data: result.response }
      } catch (error) {
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

/**
 * Hive Agent Class
 */
export class Hive {
  readonly config: HiveConfig
  private contextManager: ContextManager
  private tools: Tool[]

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
   * Get tools including internal tools for a specific run
   */
  private getRunTools(todoManager: TodoManager, reviewManager?: ReviewManager): Tool[] {
    const tools = [
      ...this.tools,
      createTodoTool(todoManager)
    ]

    if (reviewManager?.isEnabled()) {
      tools.push(createReviewTool(reviewManager))
    }

    return tools
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

    // Check if last message was an __ask_user__ tool call (needs tool_result)
    const messages: Message[] = [...history]
    const lastMessage = messages[messages.length - 1]

    if (lastMessage?.role === 'assistant' && Array.isArray(lastMessage.content)) {
      const askUserToolUse = lastMessage.content.find(
        (block): block is import('./types.js').ToolUseBlock =>
          block.type === 'tool_use' && block.name === '__ask_user__'
      )

      if (askUserToolUse) {
        // Add tool_result for the __ask_user__ call with user's response
        messages.push({
          role: 'user',
          content: [{
            type: 'tool_result',
            tool_use_id: askUserToolUse.id,
            content: JSON.stringify({ success: true, data: { answer: message } })
          }]
        })
      } else {
        // Normal user message
        messages.push({ role: 'user', content: message })
      }
    } else {
      // Normal user message
      messages.push({ role: 'user', content: message })
    }

    // Create todo manager for this run
    const todoManager = new TodoManager()

    // Create review manager if review is configured
    const reviewManager = this.config.review
      ? new ReviewManager(this.config.review)
      : undefined

    // Create tool context
    const toolContext: ToolContext = {
      remainingTokens: this.contextManager.getRemainingTokens(),
      conversationId,
      userId,
      metadata
    }

    // Execute the agent loop
    const result = await executeLoop(
      {
        systemPrompt: this.config.systemPrompt,
        tools: this.getRunTools(todoManager, reviewManager),
        llm: this.config.llm,
        logger: this.config.logger,
        maxIterations: this.config.maxIterations!,
        contextManager: this.contextManager,
        todoManager,
        reviewManager,
        llmOptions: {
          thinkingMode: this.config.thinkingMode,
          thinkingBudget: this.config.thinkingBudget
        },
        signal,
        shouldContinue
      },
      messages,
      toolContext
    )

    // Save history to repository
    if (conversationId && this.config.repository) {
      await this.config.repository.saveHistory(conversationId, result.history)
    }

    return result
  }
}
