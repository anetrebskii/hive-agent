/**
 * Prompt Builder Types
 */

/**
 * Sub-agent definition for main agent prompts
 */
export interface SubAgentDef {
  name: string
  purpose: string
  whenToUse: string
  /** Input parameters the sub-agent accepts (for documentation) */
  inputParams?: Array<{
    name: string
    description: string
    required: boolean
  }>
}

/**
 * Tool definition for prompt display
 */
export interface ToolDef {
  name: string
  description: string
}

/**
 * Context path definition
 */
export interface ContextPathDef {
  path: string
  description: string
}

/**
 * Task example for main agent prompts
 * Format: "User says X" -> "Call agent Y with Z" -> "Present result"
 */
export interface TaskExample {
  userInput: string
  action: string
  result: string
}

/**
 * Workflow step for sub-agent prompts
 */
export interface WorkflowStep {
  description: string
  toolCalls?: string[]
  askQuestion?: {
    condition?: string
    question: string
    options?: string[]
  }
}

/**
 * Output format for sub-agent prompts
 */
export interface OutputFormat {
  summaryTemplate: string
  dataFields: Record<string, string>
  errorCase?: {
    condition: string
    data: Record<string, unknown>
  }
}

/**
 * Configuration for MainAgentBuilder
 */
export interface MainAgentPromptConfig {
  role?: string
  description?: string
  subAgents?: SubAgentDef[]
  questionHandling?: {
    description?: string
    exampleFlow?: string[]
  }
  directTools?: ToolDef[]
  contextPaths?: ContextPathDef[]
  rules?: string[]
  examples?: TaskExample[]
  customSections?: Array<{
    title: string
    content: string
  }>
}

/**
 * Tool reference for sub-agent workflow steps
 */
export interface ToolStepRef {
  tool: { name: string; description: string }
  purpose?: string
}

/**
 * JSON Schema for output (simplified for prompt generation)
 */
export interface OutputSchema {
  type: 'object'
  properties?: Record<string, {
    type?: string
    description?: string
    enum?: string[]
  }>
  required?: string[]
}

/**
 * Checklist item for sub-agent prompts
 */
export interface ChecklistItem {
  task: string
  optional?: boolean
}

/**
 * Checklist configuration
 */
export interface ChecklistConfig {
  items: ChecklistItem[]
  /** Whether items must be done in order */
  sequential?: boolean
  /** Instruction for tracking progress */
  trackProgress?: boolean
}

/**
 * Example for sub-agent prompts
 */
export interface SubAgentExample {
  input: string
  output: string
  explanation?: string
}

/**
 * Configuration for SubAgentBuilder
 */
export interface SubAgentPromptConfig {
  role?: string
  task?: string
  /** Step-by-step instructions */
  instructions?: string[]
  /** Checklist of items to complete */
  checklist?: ChecklistConfig
  /** Input/output examples */
  examples?: SubAgentExample[]
  /** Things to avoid or constraints */
  constraints?: string[]
  workflow?: WorkflowStep[]
  guidelines?: string[]
  output?: OutputFormat
  /** Schema-based output (alternative to output) */
  outputSchema?: OutputSchema
  /** Available tools for the sub-agent */
  availableTools?: ToolDef[]
  contextPaths?: ContextPathDef[]
  useContext?: boolean
  customSections?: Array<{
    title: string
    content: string
  }>
}
