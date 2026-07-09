/**
 * Task Management System (Claude Code 4-Tool Approach)
 *
 * Provides task management functionality for agents to track and execute tasks.
 * Uses 4 separate tools: TaskCreate, TaskUpdate, TaskGet, TaskList
 */

import type { Tool, TaskItem, TaskStatus, TaskComment, LogProvider, TaskProgress, TaskUpdateNotification, TodoItem, TodoUpdate, TodoProgress } from "../types.js";
import type { Workspace } from "../workspace.js";

/** Path where tasks are persisted in Workspace */
const TASKS_CONTEXT_PATH = '.tuplet/tasks.json';

/** Serialized task state for persistence */
interface TaskManagerState {
  items: TaskItem[];
  currentTaskId?: string;
  nextId: number;
}

/**
 * Format task list for display
 * @param tasks - Array of tasks to format
 * @param allTasks - Optional full task list (for checking blocker status). If not provided, blockedBy status won't be resolved.
 */
export function formatTaskList(tasks: TaskItem[], allTasks?: TaskItem[]): string {
  if (tasks.length === 0) {
    return "No tasks in the task list.";
  }

  const statusEmoji: Record<TaskStatus, string> = {
    pending: "⬜",
    in_progress: "🔄",
    completed: "✅",
  };

  // Create a map for quick task lookup
  const taskMap = new Map<string, TaskItem>();
  for (const t of (allTasks || tasks)) {
    taskMap.set(t.id, t);
  }

  // Helper to check if a task has open blockers
  const hasOpenBlockers = (task: TaskItem): boolean => {
    if (!task.blockedBy || task.blockedBy.length === 0) return false;
    return task.blockedBy.some(blockerId => {
      const blocker = taskMap.get(blockerId);
      return blocker && blocker.status !== 'completed';
    });
  };

  // Helper to get open blocker IDs
  const getOpenBlockerIds = (task: TaskItem): string[] => {
    if (!task.blockedBy) return [];
    return task.blockedBy.filter(blockerId => {
      const blocker = taskMap.get(blockerId);
      return blocker && blocker.status !== 'completed';
    });
  };

  return tasks
    .map((task) => {
      const emoji = statusEmoji[task.status];
      const ownerTag = task.owner ? ` [@${task.owner}]` : '';

      // Show blocked indicator if task has open blockers
      let blockedTag = '';
      if (task.status !== 'completed' && hasOpenBlockers(task)) {
        const openBlockers = getOpenBlockerIds(task);
        blockedTag = ` (blocked by: ${openBlockers.join(', ')})`;
      }

      // Show activeForm when in_progress, otherwise show subject
      const label =
        task.status === "in_progress" && task.activeForm
          ? task.activeForm
          : task.subject;
      return `${task.id}. ${emoji} ${label}${ownerTag}${blockedTag}`;
    })
    .join("\n");
}

/** @deprecated Use formatTaskList instead */
export function formatTodoList(todos: TodoItem[]): string {
  // Convert TodoItem to TaskItem format for display
  const tasks: TaskItem[] = todos.map(todo => ({
    id: todo.id,
    subject: todo.content,
    activeForm: todo.activeForm,
    status: todo.status,
    createdAt: todo.createdAt,
    completedAt: todo.completedAt,
  }));
  return formatTaskList(tasks);
}

/**
 * TaskManager class for tracking tasks during execution
 */
export class TaskManager {
  private items: Map<string, TaskItem> = new Map();
  private currentTaskId?: string;
  private nextId: number = 1;

  /**
   * Get all task items
   */
  getAll(): TaskItem[] {
    // Return in ID order (sequential)
    return Array.from(this.items.values()).sort((a, b) =>
      parseInt(a.id) - parseInt(b.id)
    );
  }

  /**
   * Get a task by ID
   */
  get(id: string): TaskItem | undefined {
    return this.items.get(id);
  }

  /**
   * Get current task being worked on
   */
  getCurrentTask(): TaskItem | undefined {
    if (!this.currentTaskId) return undefined;
    return this.items.get(this.currentTaskId);
  }

  /**
   * Check if a task is blocked (has unresolved blockers)
   */
  isBlocked(task: TaskItem): boolean {
    if (!task.blockedBy || task.blockedBy.length === 0) return false;
    // Check if any blocker is not completed
    return task.blockedBy.some(blockerId => {
      const blocker = this.items.get(blockerId);
      return blocker && blocker.status !== 'completed';
    });
  }

  /**
   * Get open (unresolved) blockers for a task
   */
  getOpenBlockers(task: TaskItem): string[] {
    if (!task.blockedBy) return [];
    return task.blockedBy.filter(blockerId => {
      const blocker = this.items.get(blockerId);
      return blocker && blocker.status !== 'completed';
    });
  }

  /**
   * Create a new task
   * If this is the first task and no tasks are in_progress, auto-starts it (if not blocked)
   */
  create(
    subject: string,
    description?: string,
    activeForm?: string,
    metadata?: Record<string, unknown>
  ): TaskItem {
    const id = String(this.nextId++);
    const item: TaskItem = {
      id,
      subject,
      description,
      activeForm,
      status: "pending",
      metadata,
      createdAt: Date.now(),
    };
    this.items.set(id, item);

    // Auto-start if no task is currently in progress and task is not blocked
    const hasInProgress = Array.from(this.items.values()).some(
      t => t.status === "in_progress"
    );
    if (!hasInProgress && !this.isBlocked(item)) {
      item.status = "in_progress";
      this.currentTaskId = id;
    }

    return item;
  }

  /**
   * Update a task
   * Returns the updated task or undefined if not found
   */
  update(
    id: string,
    updates: {
      subject?: string;
      description?: string;
      activeForm?: string;
      status?: TaskStatus | 'deleted';
      owner?: string;
      metadata?: Record<string, unknown>;
      addBlocks?: string[];
      addBlockedBy?: string[];
      comment?: { author: string; content: string };
    }
  ): { task?: TaskItem; deleted?: boolean; next?: TaskItem } {
    const item = this.items.get(id);
    if (!item) return {};

    // Handle deletion
    if (updates.status === 'deleted') {
      // Remove this task from other tasks' blockedBy lists
      this.removeFromBlockedBy(id);
      // Remove this task from other tasks' blocks lists
      this.removeFromBlocks(id);

      this.items.delete(id);
      if (this.currentTaskId === id) {
        this.currentTaskId = undefined;
      }
      // Auto-start next pending task
      const next = this.startNextPending();
      return { deleted: true, next };
    }

    // Apply updates
    if (updates.subject !== undefined) item.subject = updates.subject;
    if (updates.description !== undefined) item.description = updates.description;
    if (updates.activeForm !== undefined) item.activeForm = updates.activeForm;
    if (updates.owner !== undefined) item.owner = updates.owner;
    if (updates.metadata !== undefined) {
      // Merge metadata, allowing null values to delete keys
      item.metadata = item.metadata || {};
      for (const [key, value] of Object.entries(updates.metadata)) {
        if (value === null) {
          delete item.metadata[key];
        } else {
          item.metadata[key] = value;
        }
      }
    }

    // Handle dependency updates
    if (updates.addBlocks) {
      item.blocks = item.blocks || [];
      for (const blockedId of updates.addBlocks) {
        if (!item.blocks.includes(blockedId)) {
          item.blocks.push(blockedId);
        }
        // Also update the blocked task's blockedBy (bidirectional)
        const blockedTask = this.items.get(blockedId);
        if (blockedTask) {
          blockedTask.blockedBy = blockedTask.blockedBy || [];
          if (!blockedTask.blockedBy.includes(id)) {
            blockedTask.blockedBy.push(id);
          }
        }
      }
    }

    if (updates.addBlockedBy) {
      item.blockedBy = item.blockedBy || [];
      for (const blockerId of updates.addBlockedBy) {
        if (!item.blockedBy.includes(blockerId)) {
          item.blockedBy.push(blockerId);
        }
        // Also update the blocker task's blocks (bidirectional)
        const blockerTask = this.items.get(blockerId);
        if (blockerTask) {
          blockerTask.blocks = blockerTask.blocks || [];
          if (!blockerTask.blocks.includes(id)) {
            blockerTask.blocks.push(id);
          }
        }
      }
    }

    // Handle comment
    if (updates.comment) {
      item.comments = item.comments || [];
      const comment: TaskComment = {
        author: updates.comment.author,
        content: updates.comment.content,
        createdAt: Date.now(),
      };
      item.comments.push(comment);
    }

    // Handle status changes
    if (updates.status) {
      const newStatus = updates.status as TaskStatus;
      const oldStatus = item.status;
      item.status = newStatus;

      if (updates.status === 'in_progress') {
        // Pause any other in_progress task
        if (this.currentTaskId && this.currentTaskId !== id) {
          const current = this.items.get(this.currentTaskId);
          if (current && current.status === 'in_progress') {
            current.status = 'pending';
          }
        }
        this.currentTaskId = id;
      } else if (updates.status === 'completed') {
        item.completedAt = Date.now();
        if (this.currentTaskId === id) {
          this.currentTaskId = undefined;
        }
        // Auto-start next pending task (checking for unblocked)
        const next = this.startNextPending();
        return { task: item, next };
      } else if (oldStatus === 'in_progress' && updates.status === 'pending') {
        if (this.currentTaskId === id) {
          this.currentTaskId = undefined;
        }
      }
    }

    return { task: item };
  }

  /**
   * Remove a task ID from all other tasks' blockedBy lists
   */
  private removeFromBlockedBy(taskId: string): void {
    for (const task of this.items.values()) {
      if (task.blockedBy) {
        task.blockedBy = task.blockedBy.filter(id => id !== taskId);
        if (task.blockedBy.length === 0) {
          delete task.blockedBy;
        }
      }
    }
  }

  /**
   * Remove a task ID from all other tasks' blocks lists
   */
  private removeFromBlocks(taskId: string): void {
    for (const task of this.items.values()) {
      if (task.blocks) {
        task.blocks = task.blocks.filter(id => id !== taskId);
        if (task.blocks.length === 0) {
          delete task.blocks;
        }
      }
    }
  }

  /**
   * Find and start the next pending task that is not blocked
   */
  private startNextPending(): TaskItem | undefined {
    const pending = this.getAll().find(
      t => t.status === 'pending' && !this.isBlocked(t)
    );
    if (pending) {
      pending.status = 'in_progress';
      this.currentTaskId = pending.id;
      return pending;
    }
    return undefined;
  }

  /**
   * Check if all tasks are completed
   */
  isAllCompleted(): boolean {
    const items = Array.from(this.items.values());
    return items.length > 0 && items.every(i => i.status === "completed");
  }

  /**
   * Get progress stats
   */
  getProgress(): TaskProgress {
    const items = Array.from(this.items.values());
    return {
      total: items.length,
      completed: items.filter(i => i.status === "completed").length,
      pending: items.filter(i => i.status === "pending").length,
      inProgress: items.filter(i => i.status === "in_progress").length,
    };
  }

  /**
   * Normalize a subject string for duplicate comparison.
   * Lowercases, strips common filler words, and collapses whitespace.
   */
  normalizeSubject(subject: string): string {
    const fillerWords = /\b(the|a|an|and|or|to|from|for|in|on|of|with|is|are|was|were|be|been|being|that|this|it)\b/g;
    return subject
      .toLowerCase()
      .replace(fillerWords, '')
      .replace(/[^a-z0-9\s]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Find a duplicate among non-completed tasks.
   * Checks for exact normalized match or substring containment.
   */
  findDuplicate(subject: string): TaskItem | undefined {
    const normalized = this.normalizeSubject(subject);
    if (!normalized) return undefined;

    for (const task of this.items.values()) {
      if (task.status === 'completed') continue;
      const existingNormalized = this.normalizeSubject(task.subject);
      if (!existingNormalized) continue;

      // Exact match after normalization
      if (normalized === existingNormalized) return task;

      // Substring containment (either direction)
      if (normalized.includes(existingNormalized) || existingNormalized.includes(normalized)) {
        return task;
      }
    }

    return undefined;
  }

  /**
   * Clear all tasks (used internally)
   */
  clear(): void {
    this.items.clear();
    this.currentTaskId = undefined;
    this.nextId = 1;
  }

  /**
   * Serialize the TaskManager state for persistence
   */
  serialize(): TaskManagerState {
    return {
      items: this.getAll(),
      currentTaskId: this.currentTaskId,
      nextId: this.nextId,
    };
  }

  /**
   * Restore TaskManager state from serialized data
   */
  restore(state: TaskManagerState): void {
    this.items.clear();
    for (const item of state.items) {
      this.items.set(item.id, item);
    }
    this.currentTaskId = state.currentTaskId;
    this.nextId = state.nextId;
  }

  /**
   * Save tasks to Workspace (if provided)
   */
  saveToWorkspace(workspace: Workspace | undefined, agentName?: string): void {
    if (!workspace) return;
    try {
      const state = this.serialize();
      workspace.write(TASKS_CONTEXT_PATH, state, agentName || 'task-manager');
    } catch {
      // Silently ignore write errors (workspace may not support this path)
    }
  }

  /**
   * Restore tasks from Workspace (if available)
   * Returns true if tasks were restored
   */
  async restoreFromWorkspace(workspace: Workspace | undefined): Promise<boolean> {
    if (!workspace) return false;
    try {
      const state = await workspace.read<TaskManagerState>(TASKS_CONTEXT_PATH);
      if (state && state.items && Array.isArray(state.items)) {
        this.restore(state);
        return true;
      }
    } catch {
      // Silently ignore read errors
    }
    return false;
  }
}

/** @deprecated Use TaskManager instead */
export const TodoManager = TaskManager;

export interface TaskToolOptions {
  /** Logger for notifying UI about task updates */
  logger?: LogProvider;
  /** Agent name (for sub-agents) */
  agentName?: string;
  /** Agent ID for ownership checks (defaults to CLAUDE_CODE_AGENT_ID env var) */
  agentId?: string;
  /** Agent type for permission checks (defaults to CLAUDE_CODE_AGENT_TYPE env var) */
  agentType?: 'team-lead' | string;
  /** Workspace for task persistence across __ask_user__ pauses */
  workspace?: Workspace;
}

/**
 * Check if the current agent can update a task
 * Returns true if:
 * - Task has no owner
 * - Current agent is the owner
 * - Current agent is a team-lead
 */
function canUpdateTask(task: TaskItem, options: TaskToolOptions): boolean {
  // No owner - anyone can update
  if (!task.owner) return true;

  const agentId = options.agentId || process.env.CLAUDE_CODE_AGENT_ID;
  const agentType = options.agentType || process.env.CLAUDE_CODE_AGENT_TYPE;

  // Team leads can update any task
  if (agentType === 'team-lead') return true;

  // Owner can update their own tasks
  if (agentId && task.owner === agentId) return true;

  return false;
}

/** @deprecated Use TaskToolOptions instead */
export type TodoToolOptions = TaskToolOptions;

/**
 * Notify logger about task list changes and persist to workspace
 */
function notifyTaskUpdate(
  manager: TaskManager,
  action: 'create' | 'update' | 'delete' | 'list',
  options: TaskToolOptions
): void {
  const { logger, agentName, workspace } = options;

  // Persist to workspace on mutations (not on list)
  if (action !== 'list' && workspace) {
    manager.saveToWorkspace(workspace, agentName);
  }

  if (logger?.onTaskUpdate) {
    const tasks = manager.getAll();
    const current = manager.getCurrentTask();
    const progress = manager.getProgress();

    logger.onTaskUpdate({
      agentName,
      action,
      tasks,
      current: current || undefined,
      progress,
    });
  }

  // Also call deprecated onTodoUpdate for backward compatibility
  if (logger?.onTodoUpdate) {
    const tasks = manager.getAll();
    const current = manager.getCurrentTask();
    const progress = manager.getProgress();

    // Convert to old format
    const todos: TodoItem[] = tasks.map(t => ({
      id: t.id,
      content: t.subject,
      activeForm: t.activeForm,
      status: t.status,
      createdAt: t.createdAt,
      completedAt: t.completedAt,
    }));

    const todoUpdate: TodoUpdate = {
      agentName,
      action: action === 'create' ? 'set' : action === 'delete' ? 'update' : action === 'list' ? 'update' : 'update',
      todos,
      current: current ? {
        id: current.id,
        content: current.subject,
        activeForm: current.activeForm,
        status: current.status,
        createdAt: current.createdAt,
        completedAt: current.completedAt,
      } : undefined,
      progress,
    };

    logger.onTodoUpdate(todoUpdate);
  }
}


/**
 * Create the TaskCreate tool
 */
export function createTaskCreateTool(manager: TaskManager, options: TaskToolOptions = {}): Tool {
  return {
    name: "TaskCreate",
    description: `Create a task in the task list. Use this to track progress on multi-step work. Duplicates are automatically rejected.

## When to Use

Use proactively when:
- The request requires 3+ distinct steps
- The user provides multiple items to accomplish
- You are starting work after receiving new instructions — capture requirements as tasks BEFORE starting
- After completing a task — add follow-up tasks discovered during implementation

Do NOT use when:
- Single, trivial task (just do it)
- Purely informational or conversational request
- Less than 3 steps needed

## Creating Good Tasks

- Create ALL tasks upfront before starting any work
- Each task = one logical unit of work, not one per file
- Include implicit steps: testing, building, verification
- Provide both subject (imperative) and activeForm (present continuous)
- Include enough context in description for the task to be self-contained

## Fields

- **subject**: Brief, actionable title in imperative form (e.g., "Fix authentication bug in login flow")
- **description**: What needs to be done, including context and acceptance criteria
- **activeForm**: Present continuous form shown in spinner when in_progress (e.g., "Fixing authentication bug"). Always provide this.

Tasks start as \`pending\`. First task auto-starts as \`in_progress\`. Duplicates are rejected.`,
    parameters: {
      type: "object",
      properties: {
        subject: {
          type: "string",
          description: "A brief title for the task",
        },
        description: {
          type: "string",
          description: "A detailed description of what needs to be done",
        },
        activeForm: {
          type: "string",
          description: 'Present continuous form shown in spinner when in_progress (e.g., "Running tests")',
        },
        metadata: {
          type: "string",
          description: "JSON string of arbitrary metadata to attach to the task",
        },
      },
      required: ["subject", "description"],
    },

    execute: async (params) => {
      const { subject, description, activeForm, metadata: rawMetadata } = params as {
        subject: string;
        description: string;
        activeForm?: string;
        metadata?: string;
      };

      // Check for duplicates before creating
      const duplicate = manager.findDuplicate(subject);
      if (duplicate) {
        return {
          success: false,
          error: `Duplicate: task #${duplicate.id} "${duplicate.subject}" already covers this. Use the existing task instead.`,
        };
      }

      // Parse metadata if provided
      let metadata: Record<string, unknown> | undefined;
      if (rawMetadata) {
        try {
          metadata = JSON.parse(rawMetadata);
        } catch {
          return { success: false, error: "Invalid metadata JSON" };
        }
      }

      const task = manager.create(subject, description, activeForm, metadata);
      const progress = manager.getProgress();

      notifyTaskUpdate(manager, 'create', options);

      return {
        success: true,
        data: {
          message: `Created task #${task.id}: "${task.subject}"${task.status === 'in_progress' ? ' (auto-started)' : ''}`,
          task,
          progress,
        },
      };
    },
  };
}

/**
 * Create the TaskUpdate tool
 */
export function createTaskUpdateTool(manager: TaskManager, options: TaskToolOptions = {}): Tool {
  return {
    name: "TaskUpdate",
    description: `Update a task's status, details, or dependencies.

Status: \`pending\` → \`in_progress\` → \`completed\`. Use \`deleted\` to remove.

Only mark completed when fully done. If blocked, keep as in_progress.

## Examples

\`\`\`json
{"taskId": "1", "status": "completed"}
{"taskId": "1", "status": "in_progress"}
{"taskId": "2", "addBlockedBy": ["1"]}
{"taskId": "1", "owner": "my-name"}
{"taskId": "1", "comment": "Started implementing"}
\`\`\`
`,
    parameters: {
      type: "object",
      properties: {
        taskId: {
          type: "string",
          description: "The ID of the task to update",
        },
        status: {
          type: "string",
          enum: ["pending", "in_progress", "completed", "deleted"],
          description: "New status for the task",
        },
        subject: {
          type: "string",
          description: "New subject for the task",
        },
        description: {
          type: "string",
          description: "New description for the task",
        },
        activeForm: {
          type: "string",
          description: 'Present continuous form shown in spinner when in_progress (e.g., "Running tests")',
        },
        owner: {
          type: "string",
          description: "New owner for the task",
        },
        metadata: {
          type: "string",
          description: "JSON string of metadata keys to merge into the task. Set a key to null to delete it.",
        },
        addBlocks: {
          type: "string",
          description: "JSON array of task IDs that this task blocks (cannot start until this completes)",
        },
        addBlockedBy: {
          type: "string",
          description: "JSON array of task IDs that block this task (must complete before this can start)",
        },
        comment: {
          type: "string",
          description: "Add a progress note or comment to the task",
        },
      },
      required: ["taskId"],
    },

    execute: async (params) => {
      const {
        taskId,
        status,
        subject,
        description,
        activeForm,
        owner,
        metadata: rawMetadata,
        addBlocks: rawAddBlocks,
        addBlockedBy: rawAddBlockedBy,
        comment,
      } = params as {
        taskId: string;
        status?: 'pending' | 'in_progress' | 'completed' | 'deleted';
        subject?: string;
        description?: string;
        activeForm?: string;
        owner?: string;
        metadata?: string;
        addBlocks?: string;
        addBlockedBy?: string;
        comment?: string;
      };

      // Check if task exists first
      const existingTask = manager.get(taskId);
      if (!existingTask) {
        return { success: false, error: `Task #${taskId} not found` };
      }

      // Check ownership permissions
      if (!canUpdateTask(existingTask, options)) {
        const agentId = options.agentId || process.env.CLAUDE_CODE_AGENT_ID || 'unknown';
        return {
          success: false,
          error: `Task #${taskId} is owned by "${existingTask.owner}" and cannot be updated by agent "${agentId}"`,
        };
      }

      // Parse metadata if provided
      let metadata: Record<string, unknown> | undefined;
      if (rawMetadata) {
        try {
          metadata = JSON.parse(rawMetadata);
        } catch {
          return { success: false, error: "Invalid metadata JSON" };
        }
      }

      // Parse addBlocks if provided
      let addBlocks: string[] | undefined;
      if (rawAddBlocks) {
        try {
          addBlocks = JSON.parse(rawAddBlocks);
          if (!Array.isArray(addBlocks)) {
            return { success: false, error: "addBlocks must be a JSON array of task IDs" };
          }
        } catch {
          return { success: false, error: "Invalid addBlocks JSON" };
        }
      }

      // Parse addBlockedBy if provided
      let addBlockedBy: string[] | undefined;
      if (rawAddBlockedBy) {
        try {
          addBlockedBy = JSON.parse(rawAddBlockedBy);
          if (!Array.isArray(addBlockedBy)) {
            return { success: false, error: "addBlockedBy must be a JSON array of task IDs" };
          }
        } catch {
          return { success: false, error: "Invalid addBlockedBy JSON" };
        }
      }

      // Build comment object if provided
      const commentObj = comment ? {
        author: options.agentId || process.env.CLAUDE_CODE_AGENT_ID || options.agentName || 'agent',
        content: comment,
      } : undefined;

      const result = manager.update(taskId, {
        status,
        subject,
        description,
        activeForm,
        owner,
        metadata,
        addBlocks,
        addBlockedBy,
        comment: commentObj,
      });

      if (result.deleted) {
        notifyTaskUpdate(manager, 'delete', options);
        const progress = manager.getProgress();
        let message = `Deleted task #${taskId}`;
        if (result.next) {
          message += `. Next task: #${result.next.id} "${result.next.subject}"`;
        }
        return {
          success: true,
          data: {
            message,
            deleted: true,
            next: result.next,
            progress,
          },
        };
      }

      if (!result.task) {
        return { success: false, error: `Task #${taskId} not found` };
      }

      notifyTaskUpdate(manager, 'update', options);
      const progress = manager.getProgress();

      let message = `Updated task #${taskId}`;
      if (status === 'completed') {
        message = `Completed task #${taskId}: "${result.task.subject}"`;
        if (result.next) {
          message += `\nNext task: #${result.next.id} "${result.next.subject}" (auto-started). Begin working on it now.`;
        } else if (manager.isAllCompleted()) {
          const allTasks = manager.getAll();
          const hasVerification = allTasks.some(t =>
            /verif|test|build|lint|check|run.*test/i.test(t.subject)
          );
          if (allTasks.length >= 3 && !hasVerification) {
            message += `\nAll tasks completed — but none was a verification step. Create a verification task (run tests, build, or lint) before responding to the user.`;
          } else {
            message += `\nAll tasks completed! Respond to the user with a summary of what was done.`;
          }
        }
      } else if (status === 'in_progress') {
        message = `Started task #${taskId}: "${result.task.subject}"`;
        message += `\nDo the work, then mark this task completed with TaskUpdate before moving on.`;
      }

      return {
        success: true,
        data: {
          message,
          task: result.task,
          next: result.next,
          progress,
        },
      };
    },
  };
}

/**
 * Create the TaskGet tool
 */
export function createTaskGetTool(manager: TaskManager, _options: TaskToolOptions = {}): Tool {
  return {
    name: "TaskGet",
    description: `Retrieve a task by ID. Returns full details: subject, description, status, dependencies, owner, and metadata.`,
    parameters: {
      type: "object",
      properties: {
        taskId: {
          type: "string",
          description: "The ID of the task to retrieve",
        },
      },
      required: ["taskId"],
    },

    execute: async (params) => {
      const { taskId } = params as { taskId: string };

      const task = manager.get(taskId);
      if (!task) {
        return { success: false, error: `Task #${taskId} not found` };
      }

      return {
        success: true,
        data: {
          task,
        },
      };
    },
  };
}

/**
 * Create the TaskList tool
 */
export function createTaskListTool(manager: TaskManager, options: TaskToolOptions = {}): Tool {
  return {
    name: "TaskList",
    description: `List all tasks with ID, subject, status, owner, and blockers.

Use after completing a task to find the next available one.
Prefer tasks in ID order (lowest first) — earlier tasks often set up context for later ones.

## Output
- id: Task identifier
- subject: Brief description
- status: pending, in_progress, or completed
- owner: Agent name if assigned, empty if available
- blockedBy: Open task IDs that must complete first (resolved blockers are hidden)`,
    parameters: {
      type: "object",
      properties: {},
      required: [],
    },

    execute: async () => {
      const tasks = manager.getAll();
      const current = manager.getCurrentTask();
      const progress = manager.getProgress();

      notifyTaskUpdate(manager, 'list', options);

      return {
        success: true,
        data: {
          message: formatTaskList(tasks, tasks),
          tasks,
          current: current?.id,
          progress,
        },
      };
    },
  };
}

/**
 * Create all 4 task management tools
 */
export function createTaskTools(manager: TaskManager, options: TaskToolOptions = {}): Tool[] {
  return [
    createTaskCreateTool(manager, options),
    createTaskUpdateTool(manager, options),
    createTaskGetTool(manager, options),
    createTaskListTool(manager, options),
  ];
}

/**
 * @deprecated Use createTaskTools instead
 */
export function createTodoTool(manager: TaskManager, options: TaskToolOptions = {}): Tool {
  // Return a legacy-compatible single tool that wraps the new system
  return {
    name: "__todo__",
    description: "Deprecated: Use TaskCreate, TaskUpdate, TaskGet, TaskList tools instead.",
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["set", "complete", "list"],
          description: "The action to perform",
        },
        items: {
          type: "string",
          description: 'Array of task descriptions (for "set" action)',
        },
      },
      required: ["action"],
    },
    execute: async (params) => {
      const { action, items: rawItems } = params as {
        action: string;
        items?: unknown;
      };

      // Parse items for set action
      type TodoInput = { content: string; activeForm?: string };
      let items: TodoInput[] | undefined;

      if (rawItems) {
        let parsed: unknown = rawItems;
        if (typeof rawItems === "string") {
          try {
            parsed = JSON.parse(rawItems);
          } catch {
            parsed = [rawItems];
          }
        }
        if (Array.isArray(parsed)) {
          items = parsed.map((item) => {
            if (typeof item === "string") {
              return { content: item };
            }
            if (typeof item === "object" && item !== null && "content" in item) {
              return {
                content: (item as { content: string }).content,
                activeForm: (item as { activeForm?: string }).activeForm,
              };
            }
            return { content: String(item) };
          });
        }
      }

      switch (action) {
        case "set": {
          if (!items || items.length === 0) {
            return { success: false, error: 'Items array is required for "set" action' };
          }
          manager.clear();
          for (const item of items) {
            manager.create(item.content, undefined, item.activeForm);
          }
          const todos = manager.getAll();
          const current = manager.getCurrentTask();
          notifyTaskUpdate(manager, 'create', options);
          return {
            success: true,
            data: {
              message: `Created ${todos.length} tasks. Starting: "${current?.activeForm || current?.subject}"`,
              todos: todos.map(t => ({ ...t, content: t.subject })),
              current: current?.activeForm || current?.subject,
            },
          };
        }

        case "complete": {
          const current = manager.getCurrentTask();
          if (!current) {
            return { success: true, data: { message: "No tasks to complete.", todos: manager.getAll() } };
          }
          const result = manager.update(current.id, { status: 'completed' });
          const progress = manager.getProgress();
          let message = `Completed: "${current.subject}". `;
          if (result.next) {
            message += `Next: "${result.next.activeForm || result.next.subject}". `;
          } else if (manager.isAllCompleted()) {
            message += "All tasks completed!";
          }
          message += `Progress: ${progress.completed}/${progress.total}`;
          notifyTaskUpdate(manager, 'update', options);
          return {
            success: true,
            data: {
              message,
              todos: manager.getAll().map(t => ({ ...t, content: t.subject })),
              current: result.next?.activeForm || result.next?.subject,
              progress,
            },
          };
        }

        case "list": {
          const tasks = manager.getAll();
          const current = manager.getCurrentTask();
          const progress = manager.getProgress();
          return {
            success: true,
            data: {
              message: formatTaskList(tasks, tasks),
              todos: tasks.map(t => ({ ...t, content: t.subject })),
              current: current?.activeForm || current?.subject,
              progress,
            },
          };
        }

        default:
          return { success: false, error: `Unknown action: ${action}` };
      }
    },
  };
}
