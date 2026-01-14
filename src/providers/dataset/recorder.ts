/**
 * Run Recorder
 *
 * Records Hive run configurations and results to JSON files.
 */

import { writeFile, mkdir } from 'fs/promises'
import { join } from 'path'
import type { HiveConfig, Tool, SubAgentConfig, AgentResult, Message } from '../../types.js'
import type {
  RunRecord,
  RunRecordConfig,
  SerializedTool,
  SerializedSubAgentConfig
} from './base.js'

/**
 * Configuration for RunRecorder
 */
export interface RunRecorderConfig {
  /** Directory to save JSON files */
  outputDir: string
}

/**
 * Records Hive runs to JSON files for later analysis and replay
 */
export class RunRecorder {
  private outputDir: string

  constructor(config: RunRecorderConfig) {
    this.outputDir = config.outputDir
  }

  /**
   * Record a run to a JSON file
   * @param inputMessage - The user's input message
   * @param initialHistory - The history before the run started
   * @param config - The Hive configuration used for the run
   * @param result - The result from Hive.run()
   * @returns The file path where the record was saved
   */
  async record(
    inputMessage: string,
    initialHistory: Message[],
    config: HiveConfig,
    result: AgentResult
  ): Promise<string> {
    const runId = this.generateRunId()
    const timestamp = Date.now()

    const record: RunRecord = {
      id: runId,
      timestamp,
      inputMessage,
      initialHistory,
      config: this.serializeConfig(config),
      result: {
        response: result.response,
        status: result.status,
        history: result.history,
        toolCalls: result.toolCalls,
        thinking: result.thinking,
        todos: result.todos,
        interrupted: result.interrupted,
        trace: result.trace
      }
    }

    // Ensure output directory exists
    await mkdir(this.outputDir, { recursive: true })

    // Save to file, stripping circular refs (parent/children)
    const filePath = join(this.outputDir, `${runId}.json`)
    const json = JSON.stringify(record, (key, value) => {
      if (key === 'parent' || key === 'children') {
        return undefined
      }
      return value
    }, 2)
    await writeFile(filePath, json, 'utf-8')

    return filePath
  }

  /**
   * Serialize HiveConfig to a JSON-safe format
   */
  private serializeConfig(config: HiveConfig): RunRecordConfig {
    return {
      systemPrompt: config.systemPrompt,
      maxIterations: config.maxIterations,
      maxContextTokens: config.maxContextTokens,
      contextStrategy: config.contextStrategy,
      agentName: config.agentName,
      tools: config.tools.map(tool => this.serializeTool(tool)),
      agents: config.agents?.map(agent => this.serializeSubAgent(agent))
    }
  }

  /**
   * Serialize a Tool to remove the execute function
   */
  private serializeTool(tool: Tool): SerializedTool {
    return {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters
    }
  }

  /**
   * Serialize a SubAgentConfig to remove non-serializable fields
   */
  private serializeSubAgent(agent: SubAgentConfig): SerializedSubAgentConfig {
    return {
      name: agent.name,
      description: agent.description,
      systemPrompt: agent.systemPrompt,
      tools: agent.tools.map(tool => this.serializeTool(tool)),
      model: agent.model,
      maxIterations: agent.maxIterations,
      inputSchema: agent.inputSchema,
      outputSchema: agent.outputSchema
    }
  }

  /**
   * Generate a unique run ID
   */
  private generateRunId(): string {
    const timestamp = Date.now()
    const random = Math.random().toString(36).slice(2, 8)
    return `run_${timestamp}_${random}`
  }
}
