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
  /** Context for tool/agent communication */
  context?: import('./context.js').Context
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
  /**
   * Input schema for structured parameters passed to this agent.
   * If defined, the __task__ tool will require these parameters instead of a free-form prompt.
   * The agent receives these as JSON in its initial message.
   */
  inputSchema?: JSONSchema
  /**
   * Output schema for structured data returned by this agent.
   * If defined, the agent should use the __output__ tool to return structured data.
   * Parent receives: { summary: string, data: <outputSchema> }
   */
  outputSchema?: JSONSchema
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

export interface CacheUsage {
  cacheCreationInputTokens: number
  cacheReadInputTokens: number
}

export interface LLMOptions {
  model?: string
}

export interface LLMProvider {
  chat(
    systemPrompt: string,
    messages: Message[],
    tools: ToolSchema[],
    options?: LLMOptions
  ): Promise<LLMResponse>

  /**
   * Get the model identifier for usage tracking.
   * Format: "provider:model" (e.g., "claude:claude-3-haiku-20240307")
   */
  getModelId?(): string
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

  /** Disable __ask_user__ tool (used for sub-agents that shouldn't pause for input) */
  disableAskUser?: boolean

  /** Trace provider for execution tracing and cost tracking */
  trace?: import('./trace.js').TraceProvider

  /** Custom model pricing for cost calculation (overrides defaults) */
  modelPricing?: Record<string, import('./trace.js').ModelPricing>

  /** Agent name for tracing (defaults to 'agent') */
  agentName?: string
}

// ============================================================================
// Agent Execution
// ============================================================================

export interface RunOptions {
  conversationId?: string
  userId?: string
  history?: Message[]

  /**
   * Context for tool/agent communication.
   * Pre-populate before run, read results after run.
   */
  context?: import('./context.js').Context

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

  /** @internal Trace builder passed from parent agent */
  _traceBuilder?: import('./trace.js').TraceBuilder
}

/**
 * Option for a question with label and optional description
 */
export interface QuestionOption {
  label: string
  description?: string
}

/**
 * Enhanced question format for multi-question sequences
 */
export interface EnhancedQuestion {
  /** The complete question to ask the user */
  question: string
  /** Short label displayed as a chip/tag (max 12 chars), e.g., "Auth method", "Library" */
  header?: string
  /** Available choices - can be simple strings or objects with label/description */
  options?: (string | QuestionOption)[]
  /** Allow multiple options to be selected (default: false) */
  multiSelect?: boolean
}

/**
 * Pending question(s) awaiting user input
 * Supports both legacy single-question format and new multi-question format
 */
export interface PendingQuestion {
  /** Legacy: Single question text */
  question?: string
  /** Legacy: Simple string options for single question */
  options?: string[]
  /** New: Array of questions for multi-question sequences (1-4 questions) */
  questions?: EnhancedQuestion[]
}

export type AgentStatus = 'complete' | 'needs_input' | 'interrupted'

export interface AgentResult {
  response: string
  history: Message[]
  toolCalls: ToolCallLog[]
  thinking?: string[]
  pendingQuestion?: PendingQuestion
  todos?: TodoItem[]
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

  /** Execution trace with usage, costs, and timing (when trace provider configured) */
  trace?: import('./trace.js').Trace
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
