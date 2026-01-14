/**
 * Prompt Builder Module
 *
 * Fluent API builders for creating main agent and sub-agent system prompts.
 */

// Types
export type {
  SubAgentDef,
  ToolDef,
  ContextPathDef,
  TaskExample,
  WorkflowStep,
  OutputFormat,
  MainAgentPromptConfig,
  SubAgentPromptConfig
} from './types.js'

// Builders
export { MainAgentBuilder } from './main-agent-builder.js'
export { SubAgentBuilder } from './sub-agent-builder.js'

// Templates (for advanced customization)
export {
  roleSection,
  subAgentsTable,
  questionHandlingSection,
  directToolsSection,
  contextStorageSection,
  rulesSection,
  taskExamplesSection,
  subAgentRoleSection,
  taskSection,
  workflowSection,
  guidelinesSection,
  outputSection
} from './templates.js'
