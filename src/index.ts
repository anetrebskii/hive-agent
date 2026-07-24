/**
 * Tuplet Agent Framework
 *
 * Minimal TypeScript agent framework inspired by Claude Code architecture.
 */

// Main agent class
export { Tuplet, Tuplet as Hive, PLAN_PATH } from './agent.js'

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
  TupletConfig,
  TupletConfig as HiveConfig,
  SubAgentConfig,
  SkillConfig,
  RunOptions,
  AgentResult,
  AgentStatus,
  PendingQuestion,
  QuestionOption,
  EnhancedQuestion,

  // Task types (new)
  TaskItem,
  TaskStatus,
  TaskComment,
  TaskProgress,
  TaskUpdateNotification,

  // Todo types (deprecated - use Task types instead)
  TodoItem,
  TodoStatus,
  TodoProgress,
  TodoUpdate,

  // Provider types
  LLMProvider,
  LLMResponse,
  LLMOptions,
  StopReason,
  LogProvider,
  RepositoryProvider,
  EnvironmentProvider,
  ProgressUpdate,

  // Cache types
  CacheUsage,

  // Config types
  ContextStrategy,
  SystemPromptConfig,
  EnvironmentInfo,

  // Prompt sections & history injections (issue #15)
  PromptSection,
  HistoryInjection,
  SectionContext,
  TurnContext,
  SectionTrigger,
  SectionContent,
  InjectionTrigger,
  InjectionContent
} from './types.js'

// Activity (semantic progress classification)
export {
  describeActivity,
  extractShellActivity,
  extractPipelineActivity,
  classifyTool,
  classifyShellCommand,
  type Activity,
  type ShellHttpRequestActivity,
  type ShellBrowseActivity,
  type ShellFileReadActivity,
  type ShellFileWriteActivity,
  type ShellFileSearchActivity,
  type ShellFileManageActivity,
  type ShellFileInfoActivity,
  type ShellDataTransformActivity,
  type ShellSystemActivity,
  type ShellOtherActivity,
  type ToolReadFileActivity,
  type ToolEditFileActivity,
  type ToolWriteFileActivity,
  type ToolSearchFilesActivity,
  type ToolSearchContentActivity,
  type ToolWebFetchActivity,
  type ToolWebSearchActivity,
  type ToolSubAgentActivity,
  type ToolTaskManageActivity,
  type ToolOtherActivity,
  type AgentThinkingActivity,
  type AgentRespondingActivity,
  type AgentInterruptedActivity
} from './activity.js'

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
  OpenRouterProvider,
  type OpenRouterProviderConfig
} from './providers/llm/openrouter.js'

export {
  FallbackProvider,
  isTransientError,
  type FallbackProviderConfig
} from './providers/llm/fallback.js'

export {
  ConsoleLogger,
  type ConsoleLoggerConfig,
  type LogLevel
} from './providers/logger/console.js'

export {
  MemoryRepository
} from './providers/repository/memory.js'

// Environment Providers
export { MemoryEnvironmentProvider } from './providers/env/memory.js'

// Utilities
export {
  estimateTokens,
  estimateMessageTokens,
  estimateTotalTokens,
  truncateOldMessages,
  sanitizeHistory,
  ContextManager
} from './context-manager.js'

export {
  summarizeMessages,
  microCompact,
  parseSummary
} from './summarizer.js'

export {
  buildSystemPrompt,
  buildEnvironmentSection,
  buildRemindersSection,
  getCurrentEnvironment,
  DEFAULT_SYSTEM_PROMPT,
  // Prompt builders
  SubAgentBuilder,
  // Template functions (for advanced customization)
  roleSection,
  subAgentsTable,
  questionHandlingSection,
  directToolsSection,
  workspaceStorageSection,
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
  type WorkspacePathDef,
  type WorkspaceStorageOptions,
  type TaskExample,
  type WorkflowStep,
  type OutputFormat,
  type SubAgentPromptConfig
} from './prompt.js'

// Task Management utilities (new 4-tool approach)
export {
  TaskManager,
  formatTaskList,
  createTaskTools,
  createTaskCreateTool,
  createTaskUpdateTool,
  createTaskGetTool,
  createTaskListTool,
  type TaskToolOptions,
  // Backward compatibility (deprecated)
  TodoManager,
  formatTodoList,
  createTodoTool,
  type TodoToolOptions
} from './tools/tasks.js'

// Tracing
export {
  TraceBuilder,
  ConsoleTraceProvider,
  LangfuseTraceProvider,
  MultiTraceProvider,
  generateTraceId,
  generateSpanId,
  calculateCost,
  DEFAULT_MODEL_PRICING,
  OPENROUTER_MODEL_PRICING,
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
  type CostUpdate,
  type ConsoleTraceConfig,
  type LangfuseTraceConfig
} from './trace.js'

// Workspace
export {
  Workspace,
  type WorkspaceEntry,
  type WorkspaceListItem,
  type WorkspaceConfig,
  type WorkspaceConfigExt,
  type PathConfig,
  type ValidatorFn,
  type ZodLike,
  type ValidationError,
  type WriteResult
} from './workspace.js'

// Workspace Providers
export {
  type WorkspaceProvider,
  type WorkspaceChange,
  type WorkspaceChangeListener,
  MemoryWorkspaceProvider,
  FileWorkspaceProvider
} from './providers/workspace/index.js'

// Shell
export {
  Shell,
  type ShellConfig,
  type ShellResult,
  type CommandHandler,
  type CommandHelp,
  type CommandFlag,
  type CommandExample
} from './shell/index.js'

// Built-in Agents
export { exploreAgent, planAgent, getBuiltInAgents } from './built-in-agents/index.js'

// MCP (Model Context Protocol) client
export {
  McpManager,
  McpConnection,
  McpHttpClient,
  parseSseMessages,
  sanitizeToolName,
  normalizeSchema,
  flattenContent,
  type McpServerConfig,
  type McpServerInfo,
  type FetchLike,
  type McpToolDef,
  type McpCallResult
} from './mcp/index.js'

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
