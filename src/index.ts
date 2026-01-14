/**
 * Hive Agent Framework
 *
 * Minimal TypeScript agent framework inspired by Claude Code architecture.
 */

// Main agent class
export { Hive } from './agent.js'

// Types
export type {
  // Message types
  Message,
  MessageRole,
  ContentBlock,
  TextBlock,
  ThinkingBlock,
  ToolUseBlock,
  ToolResultBlock,

  // Tool types
  Tool,
  ToolSchema,
  ToolResult,
  ToolContext,
  ToolCallLog,
  JSONSchema,

  // Agent types
  HiveConfig,
  SubAgentConfig,
  RunOptions,
  AgentResult,
  AgentStatus,
  PendingQuestion,
  QuestionOption,
  EnhancedQuestion,

  // Todo types
  TodoItem,
  TodoStatus,
  TodoList,

  // Provider types
  LLMProvider,
  LLMResponse,
  LLMOptions,
  StopReason,
  LogProvider,
  RepositoryProvider,
  ProgressUpdate,

  // Cache types
  CacheUsage,

  // Config types
  ContextStrategy,
  SystemPromptConfig,
  EnvironmentInfo
} from './types.js'

// Providers
export {
  ClaudeProvider,
  type ClaudeProviderConfig
} from './providers/llm/claude.js'

export {
  OpenAIProvider,
  type OpenAIProviderConfig
} from './providers/llm/openai.js'

export {
  ConsoleLogger,
  type ConsoleLoggerConfig,
  type LogLevel
} from './providers/logger/console.js'

export {
  MemoryRepository
} from './providers/repository/memory.js'

// Utilities
export {
  estimateTokens,
  estimateMessageTokens,
  estimateTotalTokens,
  truncateOldMessages,
  ContextManager
} from './context-manager.js'

export {
  buildSystemPrompt,
  buildEnvironmentSection,
  buildRemindersSection,
  getCurrentEnvironment,
  DEFAULT_SYSTEM_PROMPT,
  // Prompt builders
  MainAgentBuilder,
  SubAgentBuilder,
  // Template functions (for advanced customization)
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
  outputSection,
  // Builder types
  type SubAgentDef,
  type ToolDef,
  type ContextPathDef,
  type TaskExample,
  type WorkflowStep,
  type OutputFormat,
  type MainAgentPromptConfig,
  type SubAgentPromptConfig
} from './prompt.js'

// Todo utilities
export {
  TodoManager,
  formatTodoList
} from './tools/todo.js'

// Tracing
export {
  TraceBuilder,
  ConsoleTraceProvider,
  generateTraceId,
  generateSpanId,
  calculateCost,
  DEFAULT_MODEL_PRICING,
  type TraceProvider,
  type TraceId,
  type SpanId,
  type Trace,
  type AgentSpan,
  type TraceEvent,
  type LLMCallEvent,
  type ToolCallEvent,
  type TraceContext,
  type ModelPricing,
  type ConsoleTraceConfig
} from './trace.js'

// Context
export {
  Context,
  createContextTools,
  type ContextEntry,
  type ContextListItem,
  type ContextConfig,
  type PathConfig,
  type ValidatorFn,
  type ZodLike,
  type ValidationError,
  type WriteResult
} from './context.js'

// Dataset (Run Recording, Replay & Testing)
export {
  RunRecorder,
  RunReplayer,
  RunTester,
  type RunRecorderConfig,
  type RunRecord,
  type RunRecordConfig,
  type RunRecordResult,
  type SerializedTool,
  type SerializedSubAgentConfig,
  type RunTesterConfig,
  type TestResult,
  type TestSummary
} from './providers/dataset/index.js'
