/**
 * Main Agent Prompt Builder
 *
 * Fluent API for building main agent system prompts.
 */

import type {
  SubAgentDef,
  ToolDef,
  ContextPathDef,
  TaskExample,
  MainAgentPromptConfig
} from './types.js'
import type { Tool, SubAgentConfig } from '../types.js'
import {
  roleSection,
  subAgentsTable,
  subAgentParametersSection,
  questionHandlingSection,
  directToolsSection,
  contextStorageSection,
  rulesSection,
  taskExamplesSection
} from './templates.js'

export class MainAgentBuilder {
  private config: MainAgentPromptConfig = {
    subAgents: [],
    directTools: [],
    contextPaths: [],
    rules: [],
    examples: [],
    customSections: []
  }

  /**
   * Set the agent's role identity
   */
  role(role: string): this {
    this.config.role = role
    return this
  }

  /**
   * Set the agent's description
   */
  description(description: string): this {
    this.config.description = description
    return this
  }

  /**
   * Add a sub-agent definition manually
   */
  addSubAgent(name: string, purpose: string, whenToUse: string): this {
    this.config.subAgents!.push({ name, purpose, whenToUse })
    return this
  }

  /**
   * Add multiple sub-agents at once (manual definitions)
   */
  addSubAgents(agents: SubAgentDef[]): this {
    this.config.subAgents!.push(...agents)
    return this
  }

  /**
   * Set sub-agents from actual SubAgentConfig objects
   * Extracts name, description, and input parameters automatically
   */
  agents(configs: SubAgentConfig[]): this {
    for (const config of configs) {
      // Extract input parameters from inputSchema
      const inputParams: Array<{ name: string; description: string; required: boolean }> = []
      if (config.inputSchema?.properties) {
        const required = config.inputSchema.required || []
        for (const [name, prop] of Object.entries(config.inputSchema.properties)) {
          inputParams.push({
            name,
            description: (prop as { description?: string }).description || '',
            required: required.includes(name)
          })
        }
      }

      this.config.subAgents!.push({
        name: config.name,
        purpose: config.description,
        whenToUse: config.description,
        inputParams: inputParams.length > 0 ? inputParams : undefined
      })
    }
    return this
  }

  /**
   * Configure question handling behavior
   */
  questionHandling(options: {
    description?: string
    exampleFlow?: string[]
  }): this {
    this.config.questionHandling = options
    return this
  }

  /**
   * Add a direct tool manually
   */
  addTool(name: string, description: string): this {
    this.config.directTools!.push({ name, description })
    return this
  }

  /**
   * Add multiple tools at once (manual definitions)
   */
  addTools(tools: ToolDef[]): this {
    this.config.directTools!.push(...tools)
    return this
  }

  /**
   * Set tools from actual Tool objects
   * Extracts name and description automatically
   */
  tools(toolObjects: Tool[]): this {
    for (const tool of toolObjects) {
      // Extract first line of description for brevity
      const desc = tool.description.split('\n')[0].trim()
      this.config.directTools!.push({
        name: tool.name,
        description: desc
      })
    }
    return this
  }

  /**
   * Add a context path definition
   */
  addContextPath(path: string, description: string): this {
    this.config.contextPaths!.push({ path, description })
    return this
  }

  /**
   * Add multiple context paths at once
   */
  addContextPaths(paths: ContextPathDef[]): this {
    this.config.contextPaths!.push(...paths)
    return this
  }

  /**
   * Add a behavioral rule
   */
  addRule(rule: string): this {
    this.config.rules!.push(rule)
    return this
  }

  /**
   * Add multiple rules at once
   */
  addRules(rules: string[]): this {
    this.config.rules!.push(...rules)
    return this
  }

  /**
   * Add a task example showing the flow
   */
  addExample(example: TaskExample): this {
    this.config.examples!.push(example)
    return this
  }

  /**
   * Add multiple examples at once
   */
  addExamples(examples: TaskExample[]): this {
    this.config.examples!.push(...examples)
    return this
  }

  /**
   * Add a custom section with title and content
   */
  addSection(title: string, content: string): this {
    this.config.customSections!.push({ title, content })
    return this
  }

  /**
   * Get the current configuration
   */
  getConfig(): MainAgentPromptConfig {
    return { ...this.config }
  }

  /**
   * Build the final system prompt string
   */
  build(): string {
    const sections: string[] = []

    // Role section (required, with default)
    const role = this.config.role || 'an AI assistant'
    sections.push(roleSection(role, this.config.description))

    // Your Role header if we have sub-agents (orchestrator pattern)
    if (this.config.subAgents && this.config.subAgents.length > 0) {
      sections.push('')
      sections.push('## Your Role')
      sections.push('')
      sections.push('1. **Delegate** - Call __task__ tool to spawn sub-agents')
      sections.push('2. **Relay questions** - When sub-agent needs input, call __ask_user__ tool')
      sections.push('3. **Present results** - After sub-agent completes, you MUST output a text message to the user')
      sections.push('')
      sections.push('⚠️ CRITICAL:')
      sections.push('- Make actual tool calls, never write tool names as text')
      sections.push('- After receiving tool results, ALWAYS respond with a text message to the user')
      sections.push('- Never return an empty response')
    }

    // Sub-agents table
    if (this.config.subAgents && this.config.subAgents.length > 0) {
      sections.push('')
      sections.push(subAgentsTable(this.config.subAgents))

      // Add sub-agent parameters documentation
      const paramsSection = subAgentParametersSection(this.config.subAgents)
      if (paramsSection) {
        sections.push('')
        sections.push(paramsSection)
      }
    }

    // Question handling
    if (this.config.questionHandling || (this.config.subAgents && this.config.subAgents.length > 0)) {
      sections.push('')
      sections.push(questionHandlingSection(
        this.config.questionHandling?.description,
        this.config.questionHandling?.exampleFlow
      ))
    }

    // Direct tools
    if (this.config.directTools && this.config.directTools.length > 0) {
      sections.push('')
      sections.push(directToolsSection(this.config.directTools))
    }

    // Context storage
    if (this.config.contextPaths && this.config.contextPaths.length > 0) {
      sections.push('')
      sections.push(contextStorageSection(this.config.contextPaths))
    }

    // Task examples
    if (this.config.examples && this.config.examples.length > 0) {
      sections.push('')
      sections.push(taskExamplesSection(this.config.examples))
    }

    // Custom sections
    for (const section of this.config.customSections || []) {
      sections.push('')
      sections.push(`## ${section.title}`)
      sections.push('')
      sections.push(section.content)
    }

    // Rules (always at the end)
    if (this.config.rules && this.config.rules.length > 0) {
      sections.push('')
      sections.push(rulesSection(this.config.rules))
    }

    return sections.join('\n')
  }

  /**
   * Reset the builder to initial state
   */
  reset(): this {
    this.config = {
      subAgents: [],
      directTools: [],
      contextPaths: [],
      rules: [],
      examples: [],
      customSections: []
    }
    return this
  }
}
