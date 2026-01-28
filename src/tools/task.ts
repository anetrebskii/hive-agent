/**
 * Task Tool
 *
 * Tool for spawning sub-agents to handle complex operations.
 */

import type {
  Tool,
  SubAgentConfig,
  JSONSchema,
  HiveConfig,
  RunOptions,
  AgentResult,
  ToolResult,
  ProgressUpdate,
  LogProvider,
  TodoUpdate,
} from "../types.js";
import { TraceBuilder } from "../trace.js";
import { OUTPUT_TOOL_NAME, createOutputTool } from "./output.js";

/**
 * Interface for the parent Hive context needed by task tool
 */
export interface TaskToolContext {
  config: HiveConfig;
  getCurrentTraceBuilder(): TraceBuilder | undefined;
}

/**
 * Factory function type for creating sub-Hive instances
 */
export type CreateSubHive = (config: HiveConfig) => {
  run(message: string, options?: RunOptions): Promise<AgentResult>;
};

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
 * Create a wrapper logger that prefixes sub-agent logs
 */
function createSubLogger(
  parentLogger: LogProvider | undefined,
  agentName: string
): LogProvider | undefined {
  if (!parentLogger) return undefined;

  return {
    ...parentLogger,
    debug: (msg: string, data?: unknown) =>
      parentLogger.debug?.(`[${agentName}] ${msg}`, data),
    info: (msg: string, data?: unknown) =>
      parentLogger.info?.(`[${agentName}] ${msg}`, data),
    warn: (msg: string, data?: unknown) =>
      parentLogger.warn?.(`[${agentName}] ${msg}`, data),
    error: (msg: string, data?: unknown) =>
      parentLogger.error?.(`[${agentName}] ${msg}`, data),
    onToolCall: (toolName: string, toolParams: unknown) => {
      parentLogger.info?.(`[${agentName}] Tool: ${toolName}`);
      parentLogger.onToolCall?.(toolName, toolParams);
    },
    onToolResult: (toolName: string, result: ToolResult, durationMs: number) => {
      const status = result.success ? "OK" : "ERROR";
      parentLogger.info?.(
        `[${agentName}] Tool ${toolName}: ${status} (${durationMs}ms)`
      );
      parentLogger.onToolResult?.(toolName, result, durationMs);
    },
    onProgress: (update: ProgressUpdate) => {
      // Prefix sub-agent progress messages
      parentLogger.onProgress?.({
        ...update,
        message: `[${agentName}] ${update.message}`,
      });
    },
    onTodoUpdate: (update: TodoUpdate) => {
      // Forward sub-agent todo updates with agent name set
      parentLogger.onTodoUpdate?.({
        ...update,
        agentName: agentName,
      });
    },
  };
}

/**
 * Create the __task__ tool for spawning sub-agents
 */
export function createTaskTool(
  context: TaskToolContext,
  agents: SubAgentConfig[],
  createSubHive: CreateSubHive
): Tool {
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
        [key: string]: unknown;
      };

      const agentConfig = agents.find((a) => a.name === agentName);
      if (!agentConfig) {
        return { success: false, error: `Unknown agent: ${agentName}` };
      }

      // Build the input message for the sub-agent
      const inputMessage = `Task parameters:\n${JSON.stringify(
        inputParams,
        null,
        2
      )}`;

      // Log sub-agent start
      context.config.logger?.info(`[Sub-Agent: ${agentName}] Starting...`);
      context.config.logger?.debug(
        `[Sub-Agent: ${agentName}] Input: ${inputMessage.slice(0, 200)}${
          inputMessage.length > 200 ? "..." : ""
        }`
      );

      // Progress: sub-agent starting
      context.config.logger?.onProgress?.({
        type: "sub_agent_start",
        message: `Starting ${agentName}...`,
        details: { agentName },
      });

      try {
        // Create a wrapper logger that prefixes sub-agent logs
        const subLogger = createSubLogger(context.config.logger, agentName);

        // Use agent-specific LLM/model or fall back to parent's
        const subLlm = agentConfig.llm || context.config.llm;

        // Build sub-agent tools - include __output__ if outputSchema is defined
        const subTools = agentConfig.outputSchema
          ? [...agentConfig.tools, createOutputTool(agentConfig.outputSchema)]
          : agentConfig.tools;

        // Get parent's trace builder for nested tracing
        const parentTraceBuilder = context.getCurrentTraceBuilder();

        // Start sub-agent span in trace
        if (parentTraceBuilder) {
          parentTraceBuilder.startSubAgent(agentName, inputMessage);
        }

        const subHive = createSubHive({
          systemPrompt: agentConfig.systemPrompt,
          tools: subTools,
          llm: subLlm,
          logger: subLogger,
          maxIterations: agentConfig.maxIterations || context.config.maxIterations,
          disableAskUser: false, // Sub-agents can ask questions via __ask_user__
          // Pass parent's trace config for nested sub-agents
          trace: context.config.trace,
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
        context.config.logger?.info(
          `[Sub-Agent: ${agentName}] Completed with status: ${result.status}`
        );
        context.config.logger?.debug(
          `[Sub-Agent: ${agentName}] Tool calls: ${result.toolCalls.length}`,
          result.toolCalls.map((tc) => tc.name)
        );
        context.config.logger?.debug(
          `[Sub-Agent: ${agentName}] Response length: ${
            result.response?.length || 0
          }`
        );
        if (result.response) {
          context.config.logger?.debug(
            `[Sub-Agent: ${agentName}] Response preview: ${result.response.slice(
              0,
              200
            )}${result.response.length > 200 ? "..." : ""}`
          );
        }
        if (result.thinking && result.thinking.length > 0) {
          context.config.logger?.debug(
            `[Sub-Agent: ${agentName}] Thinking blocks: ${result.thinking.length}`
          );
        }

        // Progress: sub-agent completed
        context.config.logger?.onProgress?.({
          type: "sub_agent_end",
          message: `${agentName} completed`,
          details: { agentName, success: true },
        });

        if (result.status === "needs_input") {
          context.config.logger?.debug(
            `[Sub-Agent: ${agentName}] Returning: needs_input`
          );
          return {
            success: false,
            error: "Sub-agent needs user input",
            data: result.pendingQuestion,
          };
        }

        if (result.status === "interrupted") {
          context.config.logger?.warn(
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
        context.config.logger?.debug(
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
          context.config.logger?.debug(
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

        // Fallback: return response text as summary when __output__ tool wasn't used
        context.config.logger?.debug(
          `[Sub-Agent: ${agentName}] Returning text response (no __output__ tool used)`,
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
        const parentTraceBuilder = context.getCurrentTraceBuilder();
        if (parentTraceBuilder) {
          parentTraceBuilder.endSubAgent("error");
        }

        context.config.logger?.error(
          `[Sub-Agent: ${agentName}] Failed: ${
            error instanceof Error ? error.message : String(error)
          }`
        );

        // Progress: sub-agent failed
        context.config.logger?.onProgress?.({
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
