/**
 * Tuplet Agent Framework - Type Definitions
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

export interface JSONSchemaProperty {
  type: string
  description?: string
  enum?: string[]
  items?: JSONSchemaProperty
  properties?: Record<string, JSONSchemaProperty>
  required?: string[]
}

export interface JSONSchema {
  type: 'object'
  properties: Record<string, JSONSchemaProperty>
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
  /** Workspace for tool/agent communication */
  workspace?: import('./workspace.js').Workspace
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
   * If defined, the __sub_agent__ tool will require these parameters instead of a free-form prompt.
   * The agent receives these as JSON in its initial message.
   */
  inputSchema?: JSONSchema
  /**
   * Output schema for structured data returned by this agent.
   * If defined, the agent should use the __output__ tool to return structured data.
   * Parent receives: { summary: string, data: <outputSchema> }
   */
  outputSchema?: JSONSchema
  /** Disable __ask_user__ tool for this sub-agent */
  disableAskUser?: boolean
  /** Disable task management tools (TaskCreate, TaskUpdate, TaskGet, TaskList) */
  disableTaskTools?: boolean
  /** Runtime-injected tool names for display (e.g., ['shell (read-only)']) */
  builtInToolNames?: string[]
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
  /**
   * Model id (`provider:model`) that actually served this response. When
   * present, the executor uses it for cost accounting in place of
   * {@link LLMProvider.getModelId}. Set by routers/fallback providers whose
   * effective model varies per call.
   */
  modelId?: string
}

export interface CacheUsage {
  cacheCreationInputTokens: number
  cacheReadInputTokens: number
}

export interface LLMOptions {
  model?: string
  /** Sampling temperature (0–2 typical). Forwarded to providers that accept it. */
  temperature?: number
  /** Nucleus-sampling cutoff (0–1). Forwarded to providers that accept it. */
  topP?: number
  /** Stop sequences — generation halts when any is produced. */
  stopSequences?: string[]
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

  /** Whether this provider handles tool schemas via the API's native tool parameter.
   *  Set automatically by built-in providers (Claude, OpenAI). */
  supportsNativeTools?: boolean
}

export interface ProgressUpdate {
  type:
    | 'thinking' | 'text' | 'tool_start' | 'tool_end'
    | 'sub_agent_start' | 'sub_agent_end' | 'status' | 'usage'
  message: string
  /** Typed semantic activity classification */
  activity?: import('./activity.js').Activity
  /** User-friendly label auto-populated from activity */
  label?: string
  /** Correlation ID for start/end pairs */
  id?: string
  /** Nesting depth (0=root, 1=sub-agent, 2=nested sub-agent) */
  depth?: number
  /** Parent event ID for tree building */
  parentId?: string
  details?: {
    toolName?: string
    agentName?: string
    duration?: number
    success?: boolean
    /** Full AI text for 'text' events */
    text?: string
    /** Cumulative stats for 'usage' events */
    usage?: {
      inputTokens: number
      outputTokens: number
      elapsed?: number
      /** Cost of this specific LLM call */
      callCost?: number
      /** Cumulative cost across all LLM calls so far */
      cumulativeCost?: number
      modelId?: string
    }
  }
}

export interface LogProvider {
  debug(message: string, data?: unknown): void
  info(message: string, data?: unknown): void
  warn(message: string, data?: unknown): void
  error(message: string, data?: unknown): void

  onToolCall?(toolName: string, params: unknown, meta?: { activity?: import('./activity.js').Activity; label?: string }): void
  onToolResult?(toolName: string, result: ToolResult, durationMs: number, meta?: { activity?: import('./activity.js').Activity; label?: string }): void
  onIteration?(iteration: number, messageCount: number): void
  onComplete?(result: AgentResult): void

  /** Called with progress updates for real-time UI feedback */
  onProgress?(update: ProgressUpdate): void

  /** Called when task list is created or updated */
  onTaskUpdate?(update: TaskUpdateNotification): void

  /** @deprecated Use onTaskUpdate instead */
  onTodoUpdate?(update: TodoUpdate): void
}

export interface RepositoryProvider {
  getHistory(conversationId: string): Promise<Message[]>
  saveHistory(conversationId: string, messages: Message[]): Promise<void>

  getState?(conversationId: string): Promise<Record<string, unknown> | null>
  saveState?(conversationId: string, state: Record<string, unknown>): Promise<void>

  getCached?(key: string): Promise<unknown | null>
  setCached?(key: string, value: unknown, ttlMs?: number): Promise<void>
}

export interface EnvironmentProvider {
  /** Get a variable value by name. Returns undefined if not set. */
  get(name: string): string | undefined
  /** List available variable names (for shell tool description). Values are NOT exposed. */
  keys(): string[]
}

// ============================================================================
// Prompt Sections & History Injections (issue #15)
// ============================================================================

export interface SectionContext<TContext = unknown> {
  /** Host-provided context passed via RunOptions.context */
  context: TContext
  /** Current conversation id (empty string if none) */
  conversationId: string
}

export interface TurnContext<TContext = unknown> extends SectionContext<TContext> {
  /** 1-based index of the turn currently being processed */
  turnIndex: number
  /** Plain-text of the user message that initiated this turn */
  lastUserMessage: string
}

export type SectionTrigger<TContext = unknown> = (
  ctx: SectionContext<TContext>
) => boolean | Promise<boolean>

export type SectionContent<TContext = unknown> =
  | string
  | ((ctx: SectionContext<TContext>) => string | Promise<string>)

export type InjectionTrigger<TContext = unknown> = (
  ctx: TurnContext<TContext>
) => boolean | Promise<boolean>

export type InjectionContent<TContext = unknown> =
  | string
  | ((ctx: TurnContext<TContext>) => string | Promise<string>)

/**
 * Section evaluated once at the first turn of a conversation and appended to the
 * system prompt for the session's lifetime. See docs/prompt-sections.md.
 */
export interface PromptSection<TContext = unknown> {
  name: string
  when: SectionTrigger<TContext>
  content: SectionContent<TContext>
}

/**
 * Injection evaluated on every turn until it fires. When `when` returns true,
 * the rendered content is wrapped in a `<tuplet-note>` tag and inserted into
 * the message history before the current user turn.
 */
export interface HistoryInjection<TContext = unknown> {
  name: string
  when: InjectionTrigger<TContext>
  content: InjectionContent<TContext>
  /** Default: true. When true, the injection only fires once per session. */
  once?: boolean
}

// ============================================================================
// Skills
// ============================================================================

export interface SkillConfig {
  /** Unique name used to activate the skill (e.g., 'log_meal') */
  name: string
  /** Short description shown in system prompt listing */
  description: string
  /** When the model should activate this skill */
  whenToUse: string
  /** Full prompt loaded when skill is activated */
  prompt: string
  /** If true, only user can invoke via slash command - model cannot auto-activate */
  disableModelInvocation?: boolean
}

// ============================================================================
// Agent Configuration
// ============================================================================

export type ContextStrategy = 'summarize' | 'error'

export interface TupletConfig {
  /** What the agent is and does (e.g., 'a nutrition consultant that tracks meals and plans diets') */
  role: string

  tools: Tool[]

  agents?: SubAgentConfig[]

  /** Skills - lazy-loaded prompts activated by name */
  skills?: SkillConfig[]

  /**
   * Prompt sections conditionally appended to the system prompt.
   * Evaluated once at turn 1, cached for the session.
   */
  sections?: PromptSection<any>[]

  /**
   * History injections evaluated each turn until fired.
   * Wrapped in <tuplet-note> and inserted before the current user turn.
   */
  historyInjections?: HistoryInjection<any>[]

  llm: LLMProvider
  logger?: LogProvider
  repository?: RepositoryProvider

  maxIterations?: number
  maxContextTokens?: number
  contextStrategy?: ContextStrategy
  /** Tokens reserved as buffer before compaction triggers (default: 10% of maxContextTokens) */
  compactBuffer?: number

  /** LLM provider for summarization/compaction. Defaults to the main `llm`.
   *  Use a cheaper model (e.g., Haiku) to reduce costs. */
  compactLlm?: LLMProvider

  /**
   * Skip tool descriptions in the system prompt.
   * Set to true when your model supports native tool use (Claude, GPT-4, kimi-k2.5, etc.)
   * to avoid sending tool schemas twice (in system prompt AND API tools parameter).
   * Default: false (tools listed in system prompt for compatibility with all models).
   */
  nativeToolUse?: boolean

  /** Disable __ask_user__ tool (used for sub-agents that shouldn't pause for input) */
  disableAskUser?: boolean

  /** Disable task management tools (TaskCreate, TaskUpdate, TaskGet, TaskList) */
  disableTaskTools?: boolean

  /**
   * Whitelist of allowed URL patterns for HTTP requests (curl, browse).
   * Supports wildcards in host and path:
   * - `https://*.openfoodfacts.org/api/**` — only API paths on any subdomain
   * - `https://api.example.com/v2/**` — only v2 endpoints
   * - `*.example.com` — shorthand for any scheme, any path
   * If not set, all URLs are allowed.
   */
  allowedUrls?: string[]

  /** Trace provider for execution tracing and cost tracking */
  trace?: import('./trace.js').TraceProvider

  /** Agent name for tracing (defaults to 'agent') */
  agentName?: string

  /** Run recorder for saving run data to JSON files */
  recorder?: import('./providers/dataset/recorder.js').RunRecorder

  /** @internal Raw system prompt — used by sub-agent tool. Users should use `description`. */
  _systemPrompt?: string
}

// ============================================================================
// Agent Execution
// ============================================================================

export interface RunOptions {
  conversationId?: string
  userId?: string
  history?: Message[]

  /**
   * Workspace for tool/agent communication.
   * Pre-populate before run, read results after run.
   */
  workspace?: import('./workspace.js').Workspace

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

  /**
   * Agent execution mode:
   * - `'plan'` — Read-only. Shell blocks writes (except plan file). Only TaskList/TaskGet available. System prompt includes plan-mode instructions.
   * - `'execute'` — Full access. Plan from `.tuplet/plan.md` injected into system prompt as context.
   * - `undefined` (default) — Full access, no plan injection. Backward compatible.
   */
  mode?: 'plan' | 'execute'

  /**
   * Environment provider for secure variable resolution.
   * Variables are resolved at shell execution time — values never appear in conversation history.
   * The AI references variables by name (e.g., `$API_KEY`) and the shell resolves them.
   */
  env?: EnvironmentProvider

  /**
   * Host-provided context passed to `PromptSection.when/content` and
   * `HistoryInjection.when/content`. Opaque to Tuplet.
   */
  context?: unknown

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
}

/**
 * Pending questions awaiting user input
 */
export interface PendingQuestion {
  /** Array of questions (1-4 questions) */
  questions: EnhancedQuestion[]
}

/**
 * Agent execution status:
 * - `complete`    — Agent finished successfully and produced a response.
 * - `needs_input` — Agent paused and is waiting for user input (see `pendingQuestion`).
 * - `interrupted` — Execution was stopped early (abort signal, shouldContinue, or max iterations).
 * - `error`       — A fatal error occurred (e.g. LLM API failure, context overflow).
 *                   The `error` field contains the message. History is still saved
 *                   so the conversation can be resumed or inspected.
 */
export type AgentStatus = 'complete' | 'needs_input' | 'interrupted' | 'error'

export interface AgentResult {
  /** Final text response from the agent (empty on error/interrupt/needs_input) */
  response: string
  /**
   * Full conversation history including all messages exchanged during this run.
   * Always populated — even when status is 'error' — so progress is never lost.
   */
  history: Message[]
  /** Log of all tool calls made during execution */
  toolCalls: ToolCallLog[]
  thinking?: string[]
  pendingQuestion?: PendingQuestion
  tasks?: TaskItem[]
  /** @deprecated Use tasks instead */
  todos?: TodoItem[]
  status: AgentStatus

  /**
   * Present when status is 'interrupted'.
   * Contains partial work that can be continued or discarded.
   */
  interrupted?: {
    /** Reason for interruption */
    reason: 'aborted' | 'stopped' | 'max_iterations'
    /** Number of iterations completed before interruption */
    iterationsCompleted: number
  }

  /**
   * Present when status is 'error'.
   * Contains the error message from the failed operation (e.g. LLM API error).
   */
  error?: string

  /** Execution trace with usage, costs, and timing (when trace provider configured) */
  trace?: import('./trace.js').Trace

  /**
   * Names of HistoryInjections that fired during this run (delta for this
   * invocation only). Present when `historyInjections` is configured.
   */
  firedHistoryInjections?: string[]

  /**
   * Names of PromptSections whose `when` matched and are part of the system
   * prompt for this session (full active set, not a delta). Sections are
   * evaluated on turn 1 and cached, so each run returns the same set.
   * Present when `sections` is configured.
   */
  firedPromptSections?: string[]
}

// ============================================================================
// Task Management Types (Claude Code 4-Tool Approach)
// ============================================================================

export type TaskStatus = 'pending' | 'in_progress' | 'completed'

export interface TaskComment {
  /** Agent ID that authored the comment */
  author: string
  /** Comment content */
  content: string
  /** Timestamp when comment was added */
  createdAt: number
}

export interface TaskItem {
  id: string
  /** Brief, actionable title in imperative form (e.g., "Fix authentication bug") */
  subject: string
  /** Detailed description of what needs to be done */
  description?: string
  /** Present continuous form shown when task is in_progress (e.g., "Running tests") */
  activeForm?: string
  status: TaskStatus
  /** Agent ID that owns this task */
  owner?: string
  /** Task IDs that cannot start until this task completes */
  blocks?: string[]
  /** Task IDs that must complete before this task can start */
  blockedBy?: string[]
  /** Progress notes and discussions */
  comments?: TaskComment[]
  /** Arbitrary metadata attached to the task */
  metadata?: Record<string, unknown>
  createdAt: number
  completedAt?: number
}

export interface TaskProgress {
  total: number
  completed: number
  pending: number
  inProgress: number
}

export interface TaskUpdateNotification {
  /** Agent name (undefined for main agent, set for sub-agents) */
  agentName?: string
  /** Action that triggered the update */
  action: 'create' | 'update' | 'delete' | 'list'
  /** Full list of tasks */
  tasks: TaskItem[]
  /** Currently active task (if any) */
  current?: TaskItem
  /** Progress statistics */
  progress: TaskProgress
}

// ============================================================================
// Backward Compatibility Aliases (Deprecated)
// ============================================================================

/** @deprecated Use TaskStatus instead */
export type TodoStatus = TaskStatus

/** @deprecated Use TaskItem instead */
export interface TodoItem {
  id: string
  content: string
  activeForm?: string
  status: TodoStatus
  createdAt: number
  completedAt?: number
}

/** @deprecated Use TaskProgress instead */
export type TodoProgress = TaskProgress

/** @deprecated Use TaskUpdateNotification instead */
export interface TodoUpdate {
  agentName?: string
  action: 'set' | 'complete' | 'update'
  todos: TodoItem[]
  current?: TodoItem
  progress: TodoProgress
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
