/**
 * Hive Agent Framework - Type Definitions
 */

// ============================================================================
// Message Types (Claude API compatible)
// ============================================================================

export type MessageRole = 'user' | 'assistant'

export interface TextBlock {
  type: 'text'
  text: string
}

export interface ThinkingBlock {
  type: 'thinking'
  thinking: string
}

export interface ToolUseBlock {
  type: 'tool_use'
  id: string
  name: string
  input: Record<string, unknown>
}

export interface ToolResultBlock {
  type: 'tool_result'
  tool_use_id: string
  content: string
  is_error?: boolean
}

export type ContentBlock = TextBlock | ThinkingBlock | ToolUseBlock | ToolResultBlock

export interface Message {
  role: MessageRole
  content: string | ContentBlock[]
}

// ============================================================================
// Tool Types
// ============================================================================

export interface JSONSchema {
  type: 'object'
  properties: Record<string, {
    type: string
    description?: string
    enum?: string[]
    items?: JSONSchema
  }>
  required?: string[]
  additionalProperties?: boolean
}

export interface ToolResult {
  success: boolean
  data?: unknown
  error?: string
}

export interface ToolContext {
  remainingTokens: number
  conversationId?: string
  userId?: string
  metadata?: Record<string, unknown>
}

export interface Tool {
  name: string
  description: string
  parameters: JSONSchema
  execute: (params: Record<string, unknown>, context: ToolContext) => Promise<ToolResult>
}

export interface ToolSchema {
  name: string
  description: string
  input_schema: JSONSchema
}

export interface ToolCallLog {
  name: string
  input: Record<string, unknown>
  output: ToolResult
  durationMs: number
}

// ============================================================================
// Sub-Agent Types
// ============================================================================

export interface SubAgentConfig {
  name: string
  description: string
  systemPrompt: string
  tools: Tool[]
  /** Override model for this agent (e.g., 'gpt-4o', 'claude-3-haiku') */
  model?: string
  /** Override LLM provider for this agent (use different provider than parent) */
  llm?: LLMProvider
  /** Override max iterations for this agent */
  maxIterations?: number
}

// ============================================================================
// Provider Interfaces
// ============================================================================

export type StopReason = 'end_turn' | 'tool_use' | 'max_tokens'

export interface LLMResponse {
  content: ContentBlock[]
  stopReason: StopReason
  usage?: {
    inputTokens: number
    outputTokens: number
  }
  cacheUsage?: CacheUsage
}

export interface CacheConfig {
  enabled: boolean
  cacheSystemPrompt?: boolean   // Cache the system prompt (default: true)
  cacheTools?: boolean          // Cache tool definitions (default: true)
  cacheHistory?: boolean        // Cache conversation history (default: true)
}

export interface CacheUsage {
  cacheCreationInputTokens: number
  cacheReadInputTokens: number
}

export interface LLMOptions {
  thinkingMode?: 'none' | 'enabled'
  thinkingBudget?: number
  model?: string
  cache?: CacheConfig
}

export interface LLMProvider {
  chat(
    systemPrompt: string,
    messages: Message[],
    tools: ToolSchema[],
    options?: LLMOptions
  ): Promise<LLMResponse>
}

export interface ProgressUpdate {
  type: 'thinking' | 'tool_start' | 'tool_end' | 'sub_agent_start' | 'sub_agent_end' | 'status'
  message: string
  details?: {
    toolName?: string
    agentName?: string
    duration?: number
    success?: boolean
  }
}

export interface LogProvider {
  debug(message: string, data?: unknown): void
  info(message: string, data?: unknown): void
  warn(message: string, data?: unknown): void
  error(message: string, data?: unknown): void

  onToolCall?(toolName: string, params: unknown): void
  onToolResult?(toolName: string, result: ToolResult, durationMs: number): void
  onIteration?(iteration: number, messageCount: number): void
  onComplete?(result: AgentResult): void

  /** Called with progress updates for real-time UI feedback */
  onProgress?(update: ProgressUpdate): void
}

export interface RepositoryProvider {
  getHistory(conversationId: string): Promise<Message[]>
  saveHistory(conversationId: string, messages: Message[]): Promise<void>

  getState?(conversationId: string): Promise<Record<string, unknown> | null>
  saveState?(conversationId: string, state: Record<string, unknown>): Promise<void>

  getCached?(key: string): Promise<unknown | null>
  setCached?(key: string, value: unknown, ttlMs?: number): Promise<void>
}

// ============================================================================
// Agent Configuration
// ============================================================================

export type ContextStrategy = 'truncate_old' | 'summarize' | 'error'

export interface HiveConfig {
  systemPrompt: string
  tools: Tool[]

  agents?: SubAgentConfig[]

  llm: LLMProvider
  logger?: LogProvider
  repository?: RepositoryProvider

  maxIterations?: number
  maxContextTokens?: number
  contextStrategy?: ContextStrategy

  thinkingMode?: 'none' | 'enabled'
  thinkingBudget?: number

  review?: ReviewConfig

  /** Disable __ask_user__ tool (used for sub-agents that shouldn't pause for input) */
  disableAskUser?: boolean
}

// ============================================================================
// Agent Execution
// ============================================================================

export interface RunOptions {
  conversationId?: string
  userId?: string
  metadata?: Record<string, unknown>
  history?: Message[]

  /**
   * AbortSignal for cancellation (e.g., from AbortController)
   * When aborted, agent stops and returns partial results
   */
  signal?: AbortSignal

  /**
   * Async function to check if agent should continue
   * Called before each iteration and between tool calls
   * Return false to stop execution
   *
   * Example (Firestore):
   * ```typescript
   * shouldContinue: async () => {
   *   const doc = await db.doc(`tasks/${taskId}`).get()
   *   return doc.data()?.status !== 'stopped'
   * }
   * ```
   */
  shouldContinue?: () => Promise<boolean>
}

export interface PendingQuestion {
  question: string
  options?: string[]
}

export type AgentStatus = 'complete' | 'needs_input' | 'interrupted'

export interface AgentResult {
  response: string
  history: Message[]
  toolCalls: ToolCallLog[]
  thinking?: string[]
  pendingQuestion?: PendingQuestion
  todos?: TodoItem[]
  review?: ReviewResult
  status: AgentStatus

  /**
   * Present when status is 'interrupted'
   * Contains partial work that can be continued or discarded
   */
  interrupted?: {
    /** Reason for interruption */
    reason: 'aborted' | 'stopped' | 'max_iterations'
    /** Number of iterations completed before interruption */
    iterationsCompleted: number
  }

  usage?: {
    totalInputTokens: number
    totalOutputTokens: number
    cacheCreationInputTokens?: number
    cacheReadInputTokens?: number
  }
}

// ============================================================================
// Todo List Types
// ============================================================================

export type TodoStatus = 'pending' | 'in_progress' | 'completed'

export interface TodoItem {
  id: string
  content: string
  /** Present continuous form shown when task is in_progress (e.g., "Running tests") */
  activeForm?: string
  status: TodoStatus
  createdAt: number
  completedAt?: number
}

export interface TodoList {
  items: TodoItem[]
  currentTaskId?: string
}

// ============================================================================
// Review Types
// ============================================================================

export type ReviewSeverity = 'info' | 'warning' | 'error' | 'critical'

export interface ReviewIssue {
  severity: ReviewSeverity
  message: string
  suggestion?: string
  location?: string
}

export interface ReviewResult {
  passed: boolean
  issues: ReviewIssue[]
  summary: string
  reviewedAt: number
}

export interface ReviewConfig {
  enabled: boolean
  autoReview?: boolean           // Automatically review before completing
  requireApproval?: boolean      // Require explicit approval after review
  categories?: string[]          // What to review: 'code', 'security', 'completeness', etc.
}

// ============================================================================
// System Prompt Builder
// ============================================================================

export interface EnvironmentInfo {
  workingDirectory?: string
  platform?: string
  date?: string
  customVars?: Record<string, string>
}

export interface SystemPromptConfig {
  basePrompt: string
  environment?: EnvironmentInfo
  reminders?: string[]
}
