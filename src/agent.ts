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
  JSONSchema,
} from "./types.js";
import { ContextManager } from "./context-manager.js";
import { executeLoop } from "./executor.js";
import { TodoManager, createTodoTool } from "./todo.js";
import { TraceBuilder } from "./trace.js";
import { Context, createContextTools } from "./context.js";

/**
 * Create the __ask_user__ tool
 */
function createAskUserTool(): Tool {
  const toolName = "__ask_user__";
  return {
    name: toolName,
    description: `This tool allows you to gather additional information from the user when needed.

**Usage Guidelines:**
- Use ${toolName} when the outcome may vary and you need clarification from the user to provide an accurate result
- Before using this tool, try to use other tools in order to get required information.
- Come up with a comprehensive list of questions and options
- If you attempte to get information by other tools did not help, then use ${toolName}
- When using ${toolName}, specify a list of questions with relevant options for the user to select from
- Suggest options that the user is likely to choose based on the conversation history
- Limit your clarification request to 1-4 questions

**Do not user this tool**
- Try to gather information using list_context and get_context tools before asking user for details
- Try to use other existing tool to get more information about ther user

**Example Usage:**

<example>
User: Prepare a plan for tomorrow
<commentary>
As a nutrition specialist, you can infer the user wants a daily nutrition plan. No need to ask about the type of plan.
However, you need to clarify their activity level and nutrition goals.
</commentary>
Assistant: ${toolName} [{"question": "What is your daily activity level?", "options": ["Light", "Moderate", "Heavy"], "header": "Activity Level"}, {"question": "What is your nutrition target?", "options": ["Lose weight", "Gain weight", "Maintain weight"], "header": "Nutrition Target"}]
</example>

<example>
User: I'm going to train for a marathon
<commentary>
As a fitness trainer, you understand the user wants marathon training guidance. No need to ask about the activity type.
However, you need to know their preferred training timeline.
</commentary>
Assistant: ${toolName} [{"question": "What is your training duration?", "options": ["1 week", "2 weeks", "1 month"], "header": "Training Duration"}]
</example>

**When NOT to Use:**
<example>
User: Hello
Assistant: tool_use get_context(user/preferences.json) 
User: tool_result get_context = <User Preferences>
Assistant: Hello, Alex. How can I help you today?
User: Please provide steps on how to bake chicken for New Year's Eve
<commentary>
As a chef, you have clear context and user preferences. You can provide complete instructions without needing additional clarification.
</commentary>
Assistant: Here are the instructions...
</example>

**Question Format:**
{
  "questions": [
    {
      "question": "What is your daily activity level?",
      "header": "Activity Level",
      "options": ["Light", "Moderate", "Heavy"]
    }
  ]
}
`,
    parameters: {
      type: "object",
      properties: {
        questions: {
          type: "array",
          description:
            "Array of 1-4 questions. Each item has: question (string, required), header (short label, optional), options (array of {label, description}, optional)",
        },
      },
      required: ["questions"],
    },
    execute: async () => {
      // This tool is handled specially in the executor
      return { success: true, data: "Question sent to user" };
    },
  };
}

/**
 * Output tool name constant
 */
const OUTPUT_TOOL_NAME = "__output__";

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
      type: "object",
      properties: {
        summary: {
          type: "string",
          description: "Brief summary of what was done (1-2 sentences)",
        },
        data: outputSchema,
      },
      required: ["summary", "data"],
    } as JSONSchema,
    execute: async (params) => {
      // This tool doesn't actually execute - it's intercepted by the parent
      // The executor will capture this and return it as the result
      return { success: true, data: params };
    },
  };
}

/**
 * Build description for agent in __task__ tool
 */
function buildAgentDescription(agent: SubAgentConfig): string {
  let desc = `- **${agent.name}**: ${agent.description}`;

  if (agent.inputSchema?.properties) {
    const props = agent.inputSchema.properties as Record<
      string,
      { type?: string; description?: string }
    >;
    const paramList = Object.entries(props)
      .map(
        ([name, schema]) =>
          `${name}: ${schema.description || schema.type || "any"}`
      )
      .join(", ");
    desc += `\n  Parameters: { ${paramList} }`;
  }

  if (agent.outputSchema) {
    desc += `\n  Returns: structured data (summary + data object)`;
  }

  desc += `\n  Tools: ${agent.tools.map((t) => t.name).join(", ")}`;

  return desc;
}

/**
 * Create the __task__ tool for spawning sub-agents
 */
function createTaskTool(hive: Hive, agents: SubAgentConfig[]): Tool {
  const agentNames = agents.map((a) => a.name);
  const agentDescriptions = agents.map(buildAgentDescription).join("\n");

  // Build combined properties from all agents
  // Runtime validation will check agent-specific requirements
  const combinedProperties: Record<
    string,
    { type: string; description?: string; enum?: string[] }
  > = {
    agent: {
      type: "string",
      enum: agentNames,
      description: "Which agent to spawn",
    },
  };

  // Add properties from all agent inputSchemas
  for (const agent of agents) {
    if (agent.inputSchema?.properties) {
      const props = agent.inputSchema.properties as Record<
        string,
        { type?: string; description?: string }
      >;
      for (const [key, schema] of Object.entries(props)) {
        if (!combinedProperties[key]) {
          combinedProperties[key] = {
            type: schema.type || "string",
            description: `[${agent.name}] ${schema.description || ""}`,
          };
        }
      }
    }
  }

  // Add prompt for legacy agents
  const hasLegacyAgent = agents.some((a) => !a.inputSchema);
  if (hasLegacyAgent && !combinedProperties.prompt) {
    combinedProperties.prompt = {
      type: "string",
      description:
        "The task for the agent to perform (for agents without inputSchema)",
    };
  }

  const toolName = "__task__";
  return {
    name: toolName,
    description: `The ${toolName} tool activates specialized agents designed to autonomously execute complex operations. Each agent variant possesses distinct capabilities and has access to specific tools.

Agent types available and their associated tools:
${agentDescriptions}

When invoking the ${toolName} tool, you must provide a subagent_type parameter to designate which agent variant to utilize.

Key considerations:
- Include a brief description (3-5 words) that summarizes the agent's objective
- Upon completion, the agent returns a single message to you. This result is not displayed to the user. To share the outcome with the user, send a text message containing a concise summary of what was accomplished.
- Upon completion, the agent provides both a message and its agent ID. You can leverage this ID to reactivate the agent for subsequent related work.
- Supply clear and comprehensive prompts to enable autonomous operation and ensure the agent delivers precisely the information required.
- Agents marked as having "access to current context" can view the complete conversation history preceding the tool invocation. With these agents, you can write abbreviated prompts that reference prior context (e.g., "analyze the issue mentioned earlier") rather than duplicating information. The agent receives all previous messages and comprehends the context.
- Generally, trust the agent's output
- Explicitly inform the agent whether it should create content or conduct research (searching, reading documents, fetching information, etc.), as it cannot infer the user's intentions
- If an agent description indicates it should be utilized proactively, attempt to deploy it without waiting for an explicit user request. Apply discretion.

Example usage:

<example_agent_descriptions>
"travel-planner": deploy this agent after gathering the user's travel preferences and requirements
"welcome-handler": deploy this agent to reply to user greetings with an amusing quip
</example_agent_description>

<example>
user: "I need help planning a 5-day trip to Tokyo in spring. I love art museums and local cuisine."
assistant: I'll help you plan a comprehensive Tokyo itinerary
assistant: First, let me gather information about spring activities and create a day-by-day plan
assistant: I'm creating the following itinerary outline:
<plan>
Day 1: Arrival and Shibuya exploration
Day 2: Ueno Park museums (Tokyo National Museum, National Museum of Western Art)
Day 3: TeamLab Borderless, Odaiba waterfront
Day 4: Tsukiji Outer Market food tour, Ginza art galleries
Day 5: Meiji Shrine, Harajuku, departure preparation
</plan>
<commentary>
Since a detailed travel plan has been created, now deploy the travel-planner agent to add specific restaurant recommendations, booking details, and transportation information
</commentary>
assistant: Let me now employ the travel-planner agent to enhance this itinerary with detailed logistics
assistant: Invokes the __task__ tool to activate the travel-planner agent 
</example>

<example>
user: "Hello"
<commentary>
The user has initiated a greeting, so deploy the welcome-handler agent to provide a friendly response
</commentary>
assistant: "I'll invoke the __task__ tool to activate the welcome-handler agent"
</example>
`,

    parameters: {
      type: "object",
      properties: combinedProperties,
      required: ["agent"],
    } as JSONSchema,
    execute: async (params, toolCtx) => {
      const { agent: agentName, ...inputParams } = params as {
        agent: string;
        prompt?: string;
        [key: string]: unknown;
      };

      const agentConfig = agents.find((a) => a.name === agentName);
      if (!agentConfig) {
        return { success: false, error: `Unknown agent: ${agentName}` };
      }

      // Build the input message for the sub-agent
      let inputMessage: string;
      if (agentConfig.inputSchema) {
        // Schema-based: pass parameters as JSON
        inputMessage = `Task parameters:\n${JSON.stringify(
          inputParams,
          null,
          2
        )}`;
      } else {
        // Legacy: use prompt directly
        inputMessage = (inputParams.prompt as string) || "";
      }

      // Log sub-agent start
      hive.config.logger?.info(`[Sub-Agent: ${agentName}] Starting...`);
      hive.config.logger?.debug(
        `[Sub-Agent: ${agentName}] Input: ${inputMessage.slice(0, 200)}${
          inputMessage.length > 200 ? "..." : ""
        }`
      );

      // Progress: sub-agent starting
      hive.config.logger?.onProgress?.({
        type: "sub_agent_start",
        message: `Starting ${agentName}...`,
        details: { agentName },
      });

      try {
        // Create a wrapper logger that prefixes sub-agent logs
        const subLogger = hive.config.logger
          ? {
              ...hive.config.logger,
              debug: (msg: string, data?: unknown) =>
                hive.config.logger?.debug(`[${agentName}] ${msg}`, data),
              info: (msg: string, data?: unknown) =>
                hive.config.logger?.info(`[${agentName}] ${msg}`, data),
              warn: (msg: string, data?: unknown) =>
                hive.config.logger?.warn(`[${agentName}] ${msg}`, data),
              error: (msg: string, data?: unknown) =>
                hive.config.logger?.error(`[${agentName}] ${msg}`, data),
              onToolCall: (toolName: string, toolParams: unknown) => {
                hive.config.logger?.info(`[${agentName}] Tool: ${toolName}`);
                hive.config.logger?.onToolCall?.(toolName, toolParams);
              },
              onToolResult: (
                toolName: string,
                result: import("./types.js").ToolResult,
                durationMs: number
              ) => {
                const status = result.success ? "OK" : "ERROR";
                hive.config.logger?.info(
                  `[${agentName}] Tool ${toolName}: ${status} (${durationMs}ms)`
                );
                hive.config.logger?.onToolResult?.(
                  toolName,
                  result,
                  durationMs
                );
              },
              onProgress: (update: import("./types.js").ProgressUpdate) => {
                // Prefix sub-agent progress messages
                hive.config.logger?.onProgress?.({
                  ...update,
                  message: `[${agentName}] ${update.message}`,
                });
              },
            }
          : undefined;

        // Use agent-specific LLM/model or fall back to parent's
        const subLlm = agentConfig.llm || hive.config.llm;

        // Build sub-agent tools - include __output__ if outputSchema is defined
        const subTools = agentConfig.outputSchema
          ? [...agentConfig.tools, createOutputTool(agentConfig.outputSchema)]
          : agentConfig.tools;

        // Get parent's trace builder for nested tracing
        const parentTraceBuilder = hive.getCurrentTraceBuilder();

        // Start sub-agent span in trace
        if (parentTraceBuilder) {
          parentTraceBuilder.startSubAgent(agentName, inputMessage);
        }

        const subHive = new Hive({
          systemPrompt: agentConfig.systemPrompt,
          tools: subTools,
          llm: subLlm,
          logger: subLogger,
          maxIterations: agentConfig.maxIterations || hive.config.maxIterations,
          disableAskUser: true, // Sub-agents return questions as text, not via __ask_user__
          // Pass parent's trace config for nested sub-agents
          trace: hive.config.trace,
          agentName: agentName,
        });

        const result = await subHive.run(inputMessage, {
          // Pass trace builder for nested tracing
          _traceBuilder: parentTraceBuilder,
          // Pass context to sub-agent so its tools receive the same context
          conversationId: toolCtx.conversationId,
          userId: toolCtx.userId,
          // Pass context so sub-agent can read/write to same context
          context: toolCtx.context,
        });

        // End sub-agent span in trace
        if (parentTraceBuilder) {
          const status =
            result.status === "complete"
              ? "complete"
              : result.status === "interrupted"
              ? "interrupted"
              : "error";
          parentTraceBuilder.endSubAgent(status, result.response);
        }

        // Log sub-agent completion with details
        hive.config.logger?.info(
          `[Sub-Agent: ${agentName}] Completed with status: ${result.status}`
        );
        hive.config.logger?.debug(
          `[Sub-Agent: ${agentName}] Tool calls: ${result.toolCalls.length}`,
          result.toolCalls.map((tc) => tc.name)
        );
        hive.config.logger?.debug(
          `[Sub-Agent: ${agentName}] Response length: ${
            result.response?.length || 0
          }`
        );
        if (result.response) {
          hive.config.logger?.debug(
            `[Sub-Agent: ${agentName}] Response preview: ${result.response.slice(
              0,
              200
            )}${result.response.length > 200 ? "..." : ""}`
          );
        }
        if (result.thinking && result.thinking.length > 0) {
          hive.config.logger?.debug(
            `[Sub-Agent: ${agentName}] Thinking blocks: ${result.thinking.length}`
          );
        }

        // Progress: sub-agent completed
        hive.config.logger?.onProgress?.({
          type: "sub_agent_end",
          message: `${agentName} completed`,
          details: { agentName, success: true },
        });

        if (result.status === "needs_input") {
          hive.config.logger?.debug(
            `[Sub-Agent: ${agentName}] Returning: needs_input`
          );
          return {
            success: false,
            error: "Sub-agent needs user input",
            data: result.pendingQuestion,
          };
        }

        if (result.status === "interrupted") {
          hive.config.logger?.warn(
            `[Sub-Agent: ${agentName}] Was interrupted: ${result.interrupted?.reason}`
          );
          return {
            success: false,
            error: `Sub-agent was interrupted: ${
              result.interrupted?.reason || "unknown"
            }`,
            data: {
              reason: result.interrupted?.reason,
              iterationsCompleted: result.interrupted?.iterationsCompleted,
            },
          };
        }

        // Check if sub-agent used __output__ tool to return structured data
        const outputCall = result.toolCalls.find(
          (tc) => tc.name === OUTPUT_TOOL_NAME
        );
        hive.config.logger?.debug(
          `[Sub-Agent: ${agentName}] __output__ tool used: ${!!outputCall}`
        );

        if (
          outputCall &&
          outputCall.output?.success &&
          outputCall.output?.data
        ) {
          const outputData = outputCall.output.data as {
            summary: string;
            data: unknown;
          };
          hive.config.logger?.debug(
            `[Sub-Agent: ${agentName}] Returning structured output`,
            {
              summaryLength: outputData.summary?.length || 0,
              hasData:
                outputData.data !== null && outputData.data !== undefined,
            }
          );
          return {
            success: true,
            data: {
              summary: outputData.summary,
              data: outputData.data,
            },
          };
        }

        // Legacy: return response text as summary
        hive.config.logger?.debug(
          `[Sub-Agent: ${agentName}] Returning legacy response`,
          {
            responseLength: result.response?.length || 0,
            isEmpty: !result.response,
          }
        );
        return {
          success: true,
          data: {
            summary: result.response,
            data: null,
          },
        };
      } catch (error) {
        // End sub-agent span with error status
        const parentTraceBuilder = hive.getCurrentTraceBuilder();
        if (parentTraceBuilder) {
          parentTraceBuilder.endSubAgent("error");
        }

        hive.config.logger?.error(
          `[Sub-Agent: ${agentName}] Failed: ${
            error instanceof Error ? error.message : String(error)
          }`
        );

        // Progress: sub-agent failed
        hive.config.logger?.onProgress?.({
          type: "sub_agent_end",
          message: `${agentName} failed`,
          details: { agentName, success: false },
        });

        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
  };
}

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
      this.tools.push(createTaskTool(this, config.agents));
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
    const tools = [...this.tools, createTodoTool(todoManager)];

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
