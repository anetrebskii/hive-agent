/**
 * Sub-Agent Prompt Builder
 *
 * Fluent API for building sub-agent system prompts.
 */

import type {
  WorkflowStep,
  OutputFormat,
  OutputSchema,
  SubAgentPromptConfig,
  ContextPathDef,
  ToolStepRef,
  ChecklistItem,
  SubAgentExample
} from './types.js'
import type { Tool, JSONSchema } from '../types.js'
import {
  subAgentRoleSection,
  taskSection,
  workflowSection,
  guidelinesSection,
  outputSection,
  outputSchemaSection,
  availableToolsSection,
  instructionsSection,
  checklistSection,
  subAgentExamplesSection,
  constraintsSection,
  inputParametersSection
} from './templates.js'

export class SubAgentBuilder {
  private config: SubAgentPromptConfig = {
    workflow: [],
    guidelines: [],
    instructions: [],
    constraints: [],
    examples: [],
    contextPaths: [],
    useContext: false,
    customSections: [],
    availableTools: []
  }

  /**
   * Set the sub-agent's role (e.g., "a Nutrition Counter assistant")
   */
  role(role: string): this {
    this.config.role = role
    return this
  }

  /**
   * Set the task description
   */
  task(task: string): this {
    this.config.task = task
    return this
  }

  /**
   * Add step-by-step instructions
   */
  instructions(instructions: string[]): this {
    this.config.instructions = instructions
    return this
  }

  /**
   * Add a single instruction
   */
  addInstruction(instruction: string): this {
    this.config.instructions!.push(instruction)
    return this
  }

  /**
   * Enable todo tracking - AI will plan and track its own work
   * @param options.exampleSteps - Example todos to guide the AI (optional)
   */
  useTodoTracking(options?: {
    exampleSteps?: string[]
  }): this {
    this.config.checklist = {
      items: (options?.exampleSteps || []).map(step => ({ task: step })),
      trackProgress: true
    }
    return this
  }

  /**
   * Add guidance items (without todo tracking)
   * @deprecated Use useTodoTracking() for progress tracking, or addGuidelines() for static guidance
   */
  checklist(items: (string | ChecklistItem)[], options?: {
    sequential?: boolean
    trackProgress?: boolean
  }): this {
    this.config.checklist = {
      items: items.map(item =>
        typeof item === 'string' ? { task: item } : item
      ),
      sequential: options?.sequential,
      trackProgress: options?.trackProgress
    }
    return this
  }

  /**
   * Add an input/output example
   */
  addExample(input: string, output: string, explanation?: string): this {
    this.config.examples!.push({ input, output, explanation })
    return this
  }

  /**
   * Add multiple examples at once
   */
  examples(examples: SubAgentExample[]): this {
    this.config.examples!.push(...examples)
    return this
  }

  /**
   * Add a constraint (thing to avoid)
   */
  addConstraint(constraint: string): this {
    this.config.constraints!.push(constraint)
    return this
  }

  /**
   * Add multiple constraints at once
   */
  constraints(constraints: string[]): this {
    this.config.constraints!.push(...constraints)
    return this
  }

  /**
   * Add a workflow step
   */
  addStep(step: WorkflowStep): this {
    this.config.workflow!.push(step)
    return this
  }

  /**
   * Add a step that may ask a question
   */
  addQuestionStep(
    description: string,
    askQuestion: {
      condition?: string
      question: string
      options?: string[]
    }
  ): this {
    this.config.workflow!.push({
      description,
      askQuestion
    })
    return this
  }

  /**
   * Add a step with tool calls
   */
  addToolStep(description: string, toolCalls: string[]): this {
    this.config.workflow!.push({
      description,
      toolCalls
    })
    return this
  }

  /**
   * Add a guideline
   */
  addGuideline(guideline: string): this {
    this.config.guidelines!.push(guideline)
    return this
  }

  /**
   * Add multiple guidelines at once
   */
  addGuidelines(guidelines: string[]): this {
    this.config.guidelines!.push(...guidelines)
    return this
  }

  /**
   * Enable context discovery - agent will check context before starting work
   */
  useContext(): this {
    this.config.useContext = true
    return this
  }

  /**
   * Add a context path the agent should check
   */
  addContextPath(path: string, description: string): this {
    this.config.contextPaths!.push({ path, description })
    this.config.useContext = true
    return this
  }

  /**
   * Add multiple context paths at once
   */
  addContextPaths(paths: ContextPathDef[]): this {
    this.config.contextPaths!.push(...paths)
    this.config.useContext = true
    return this
  }

  /**
   * Set the output format
   */
  output(format: OutputFormat): this {
    this.config.output = format
    return this
  }

  /**
   * Shorthand for common output format
   * @deprecated Use outputSchema() instead for type-safe output definition
   */
  outputWithSummary(
    summaryTemplate: string,
    dataFields: Record<string, string>,
    errorCase?: { condition: string; data: Record<string, unknown> }
  ): this {
    this.config.output = {
      summaryTemplate,
      dataFields,
      errorCase
    }
    return this
  }

  /**
   * Set output schema - generates output instructions from the schema
   * This is the preferred way to define output format (type-safe)
   */
  outputSchema(schema: JSONSchema): this {
    // Convert JSONSchema to OutputSchema format
    this.config.outputSchema = schema as OutputSchema
    return this
  }

  /**
   * Set available tools from actual Tool objects
   * Extracts name and description automatically for documentation
   */
  tools(toolObjects: Tool[]): this {
    for (const tool of toolObjects) {
      // Extract first line of description for brevity
      const desc = tool.description.split('\n')[0].trim()
      this.config.availableTools!.push({
        name: tool.name,
        description: desc
      })
    }
    return this
  }

  /**
   * Add a workflow step that uses specific tools
   * Type-safe alternative to addToolStep with string arrays
   */
  addToolsStep(description: string, toolRefs: ToolStepRef[]): this {
    const toolCalls = toolRefs.map(ref => {
      const purpose = ref.purpose ? ` - ${ref.purpose}` : ''
      return `${ref.tool.name}${purpose}`
    })
    this.config.workflow!.push({
      description,
      toolCalls
    })
    return this
  }

  /**
   * Add a custom section
   */
  addSection(title: string, content: string): this {
    this.config.customSections!.push({ title, content })
    return this
  }

  /**
   * Get the current configuration
   */
  getConfig(): SubAgentPromptConfig {
    return { ...this.config }
  }

  /**
   * Build the final system prompt string
   */
  build(): string {
    const sections: string[] = []

    // Role section (required, with default)
    const role = this.config.role || 'a specialized assistant'
    sections.push(subAgentRoleSection(role))

    // Task section
    if (this.config.task) {
      sections.push('')
      sections.push(taskSection(this.config.task))
    }

    // Instructions section
    if (this.config.instructions && this.config.instructions.length > 0) {
      sections.push('')
      sections.push(instructionsSection(this.config.instructions))
    }

    // Checklist section
    if (this.config.checklist && this.config.checklist.items.length > 0) {
      sections.push('')
      sections.push(checklistSection(this.config.checklist))
    }

    // Available tools section (before context discovery)
    if (this.config.availableTools && this.config.availableTools.length > 0) {
      sections.push('')
      sections.push(availableToolsSection(this.config.availableTools))
    }

    // Context discovery section (before workflow)
    if (this.config.useContext) {
      sections.push('')
      sections.push('## Context Discovery (Do This First!)')
      sections.push('')
      sections.push('⚠️ ALWAYS check context BEFORE asking questions or starting work:')
      sections.push('')
      sections.push('1. Use **context_ls** to see what data exists')
      sections.push('2. Use **context_read** to read relevant paths')
      sections.push('3. Use information from context instead of asking the user')

      if (this.config.contextPaths && this.config.contextPaths.length > 0) {
        sections.push('')
        sections.push('Check these paths:')
        for (const path of this.config.contextPaths) {
          sections.push(`- ${path.path} - ${path.description}`)
        }
      }
    }

    // Check if we have question steps with conditions - add input parameters section
    const hasQuestionSteps = this.config.workflow?.some(
      step => step.askQuestion?.condition
    )
    if (hasQuestionSteps) {
      sections.push('')
      sections.push(inputParametersSection())
    }

    // Workflow steps
    if (this.config.workflow && this.config.workflow.length > 0) {
      sections.push('')
      sections.push(workflowSection(this.config.workflow))
    }

    // Guidelines
    if (this.config.guidelines && this.config.guidelines.length > 0) {
      sections.push('')
      sections.push(guidelinesSection(this.config.guidelines))
    }

    // Constraints section
    if (this.config.constraints && this.config.constraints.length > 0) {
      sections.push('')
      sections.push(constraintsSection(this.config.constraints))
    }

    // Examples section
    if (this.config.examples && this.config.examples.length > 0) {
      sections.push('')
      sections.push(subAgentExamplesSection(this.config.examples))
    }

    // Custom sections
    for (const section of this.config.customSections || []) {
      sections.push('')
      sections.push(`## ${section.title}`)
      sections.push('')
      sections.push(section.content)
    }

    // Output format (always at the end)
    // Prefer outputSchema over deprecated output format
    if (this.config.outputSchema) {
      sections.push('')
      sections.push(outputSchemaSection(this.config.outputSchema))
    } else if (this.config.output) {
      sections.push('')
      sections.push(outputSection(this.config.output))
    }

    return sections.join('\n')
  }

  /**
   * Reset the builder to initial state
   */
  reset(): this {
    this.config = {
      workflow: [],
      guidelines: [],
      instructions: [],
      constraints: [],
      examples: [],
      contextPaths: [],
      useContext: false,
      customSections: [],
      availableTools: []
    }
    return this
  }
}
