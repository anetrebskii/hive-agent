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

  // Cache types
  CacheConfig,
  CacheUsage,

  // Review types
  ReviewResult,
  ReviewIssue,
  ReviewSeverity,
  ReviewConfig,

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
} from './context.js'

export {
  buildSystemPrompt,
  buildEnvironmentSection,
  buildRemindersSection,
  getCurrentEnvironment,
  DEFAULT_SYSTEM_PROMPT
} from './prompt.js'

// Todo utilities
export {
  TodoManager,
  formatTodoList
} from './todo.js'

// Review utilities
export {
  ReviewManager,
  formatReviewResult,
  buildReviewInstructions,
  DEFAULT_REVIEW_CATEGORIES
} from './review.js'
