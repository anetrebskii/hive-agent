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
} from "./types.js";
import { ContextManager } from "./context-manager.js";
import { executeLoop } from "./executor.js";
import { TraceBuilder } from "./trace.js";
import { Context, createContextTools } from "./context.js";
import {
  createAskUserTool,
  createTaskTool,
  TodoManager,
  createTodoTool,
} from "./tools/index.js";

/**
 * Hive Agent Class
 */
export class Hive {
  readonly config: HiveConfig;
  private contextManager: ContextManager;
  private tools: Tool[];
  /** Current trace builder (set during run, used by __task__ tool) */
  private currentTraceBuilder?: TraceBuilder;

  constructor(config: HiveConfig) {
    this.config = {
      maxIterations: 50,
      maxContextTokens: 100000,
      contextStrategy: "truncate_old",
      ...config,
    };

    this.contextManager = new ContextManager(
      this.config.maxContextTokens,
      this.config.contextStrategy
    );

    // Build tools list with internal tools (todo tool added per-run)
    this.tools = [...config.tools];

    // Add __ask_user__ tool unless disabled (sub-agents shouldn't use it)
    if (!config.disableAskUser) {
      this.tools.push(createAskUserTool());
    }

    // Add __task__ tool if sub-agents are defined
    if (config.agents && config.agents.length > 0) {
      this.tools.push(
        createTaskTool(
          {
            config: this.config,
            getCurrentTraceBuilder: () => this.getCurrentTraceBuilder(),
          },
          config.agents,
          (subConfig) => new Hive(subConfig)
        )
      );
    }
  }

  /**
   * Get the current trace builder (used by __task__ tool for sub-agent tracing)
   */
  getCurrentTraceBuilder(): TraceBuilder | undefined {
    return this.currentTraceBuilder;
  }

  /**
   * Set the current trace builder (called at start of run)
   */
  setCurrentTraceBuilder(builder: TraceBuilder | undefined): void {
    this.currentTraceBuilder = builder;
  }

  /**
   * Get tools including internal tools for a specific run
   */
  private getRunTools(
    todoManager: TodoManager,
    context?: Context,
    agentName?: string
  ): Tool[] {
    const tools = [
      ...this.tools,
      createTodoTool(todoManager, {
        logger: this.config.logger,
        agentName,
      }),
    ];

    // Add context tools if Context is provided
    if (context) {
      tools.push(...createContextTools(context, agentName));
    }

    return tools;
  }

  /**
   * Run the agent with a user message
   */
  async run(message: string, options: RunOptions = {}): Promise<AgentResult> {
    const {
      conversationId,
      userId,
      history: providedHistory,
      signal,
      shouldContinue,
      context,
    } = options;

    // Load history from repository or use provided
    let history: Message[] = [];

    if (providedHistory) {
      history = providedHistory;
    } else if (conversationId && this.config.repository) {
      history = await this.config.repository.getHistory(conversationId);
    }

    // Handle history with pending tool_use blocks (from interrupted executions)
    const messages: Message[] = [...history];
    const lastMessage = messages[messages.length - 1];

    // Check if last message is assistant with tool_use blocks that need results
    if (
      lastMessage?.role === "assistant" &&
      Array.isArray(lastMessage.content)
    ) {
      const toolUseBlocks = lastMessage.content.filter(
        (block): block is import("./types.js").ToolUseBlock =>
          block.type === "tool_use"
      );

      if (toolUseBlocks.length > 0) {
        // Find __ask_user__ tool if present
        const askUserToolUse = toolUseBlocks.find(
          (block) => block.name === "__ask_user__"
        );

        // Build tool_results for all tool_use blocks
        const toolResults: import("./types.js").ToolResultBlock[] =
          toolUseBlocks.map((toolUse) => {
            if (toolUse.name === "__ask_user__") {
              // User's message is the answer to __ask_user__
              return {
                type: "tool_result" as const,
                tool_use_id: toolUse.id,
                content: JSON.stringify({
                  success: true,
                  data: { answer: message },
                }),
              };
            } else {
              // Other tools were interrupted - mark as cancelled
              return {
                type: "tool_result" as const,
                tool_use_id: toolUse.id,
                content: JSON.stringify({
                  success: false,
                  error: "Operation cancelled - execution was interrupted",
                }),
                is_error: true,
              };
            }
          });

        // If there was an __ask_user__, the user's message is already the answer
        // Otherwise, we need to include both the tool_results and the user message
        if (askUserToolUse) {
          messages.push({ role: "user", content: toolResults });
        } else {
          // Combine tool_results and user message in a single user message
          // (API doesn't allow consecutive user messages)
          messages.push({
            role: "user",
            content: [...toolResults, { type: "text" as const, text: message }],
          });
        }
      } else {
        // No tool_use blocks, normal user message
        messages.push({ role: "user", content: message });
      }
    } else {
      // Normal user message
      messages.push({ role: "user", content: message });
    }

    // Create todo manager for this run
    const todoManager = new TodoManager();

    // Create tool context
    const toolContext: ToolContext = {
      remainingTokens: this.contextManager.getRemainingTokens(),
      conversationId,
      userId,
      context,
    };

    // Create or use existing trace builder
    // If _traceBuilder is passed (from parent agent), use it
    // Otherwise create a new one if trace provider is configured
    const traceBuilder =
      options._traceBuilder ||
      (this.config.trace
        ? new TraceBuilder(
            this.config.agentName || "agent",
            this.config.trace,
            message // Pass input message to trace
          )
        : undefined);

    // Store trace builder for __task__ tool to access
    this.setCurrentTraceBuilder(traceBuilder);

    // Execute the agent loop
    const result = await executeLoop(
      {
        systemPrompt: this.config.systemPrompt,
        tools: this.getRunTools(todoManager, context, this.config.agentName),
        llm: this.config.llm,
        logger: this.config.logger,
        maxIterations: this.config.maxIterations!,
        contextManager: this.contextManager,
        todoManager,
        llmOptions: {},
        signal,
        shouldContinue,
        traceBuilder,
      },
      messages,
      toolContext
    );

    // Save history to repository
    if (conversationId && this.config.repository) {
      await this.config.repository.saveHistory(conversationId, result.history);
    }

    // End trace and attach to result (only for root agent, not sub-agents)
    if (traceBuilder && !options._traceBuilder) {
      const status =
        result.status === "complete"
          ? "complete"
          : result.status === "interrupted"
          ? "interrupted"
          : "complete";
      result.trace = traceBuilder.endTrace(status, result.response);
    }

    // Record the run (only for root agent, not sub-agents)
    if (this.config.recorder && !options._traceBuilder) {
      try {
        await this.config.recorder.record(
          message,
          history,
          this.config,
          result
        );
      } catch (error) {
        this.config.logger?.warn("Failed to record run", error);
      }
    }

    return result;
  }
}
