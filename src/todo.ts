/**
 * Todo List Management
 *
 * Provides todo list functionality for agents to track and execute tasks.
 */

import type { Tool, TodoItem, TodoStatus, TodoList } from './types.js'

/**
 * Generate unique ID for todo items
 */
function generateId(): string {
  return Math.random().toString(36).substring(2, 9)
}

/**
 * Format todo list for display
 */
export function formatTodoList(todos: TodoItem[]): string {
  if (todos.length === 0) {
    return 'No tasks in the todo list.'
  }

  const statusEmoji: Record<TodoStatus, string> = {
    pending: '⬜',
    in_progress: '🔄',
    completed: '✅'
  }

  return todos
    .map((todo, index) => {
      const emoji = statusEmoji[todo.status]
      // Show activeForm when in_progress, otherwise show content
      const label = todo.status === 'in_progress' && todo.activeForm
        ? todo.activeForm
        : todo.content
      return `${index + 1}. ${emoji} ${label}`
    })
    .join('\n')
}

/**
 * Create the TodoManager class for tracking todos during execution
 */
export class TodoManager {
  private items: Map<string, TodoItem> = new Map()
  private currentTaskId?: string

  /**
   * Get all todo items
   */
  getAll(): TodoItem[] {
    return Array.from(this.items.values())
  }

  /**
   * Get current task being worked on
   */
  getCurrentTask(): TodoItem | undefined {
    if (!this.currentTaskId) return undefined
    return this.items.get(this.currentTaskId)
  }

  /**
   * Add a new todo item
   */
  add(content: string, activeForm?: string): TodoItem {
    const item: TodoItem = {
      id: generateId(),
      content,
      activeForm,
      status: 'pending',
      createdAt: Date.now()
    }
    this.items.set(item.id, item)
    return item
  }

  /**
   * Set multiple todos at once (replaces existing)
   */
  setAll(todos: Array<{ content: string; activeForm?: string; status?: TodoStatus }>): TodoItem[] {
    this.items.clear()
    this.currentTaskId = undefined

    const items = todos.map(todo => {
      const item: TodoItem = {
        id: generateId(),
        content: todo.content,
        activeForm: todo.activeForm,
        status: todo.status || 'pending',
        createdAt: Date.now()
      }
      this.items.set(item.id, item)
      return item
    })

    // Set first pending as in_progress
    const firstPending = items.find(i => i.status === 'pending')
    if (firstPending) {
      firstPending.status = 'in_progress'
      this.currentTaskId = firstPending.id
    }

    return items
  }

  /**
   * Mark a todo as in progress
   */
  startTask(id: string): TodoItem | undefined {
    const item = this.items.get(id)
    if (!item) return undefined

    // Mark previous current as pending if not completed
    if (this.currentTaskId && this.currentTaskId !== id) {
      const current = this.items.get(this.currentTaskId)
      if (current && current.status === 'in_progress') {
        current.status = 'pending'
      }
    }

    item.status = 'in_progress'
    this.currentTaskId = id
    return item
  }

  /**
   * Mark a todo as completed and start next
   */
  completeTask(id: string): { completed: TodoItem; next?: TodoItem } | undefined {
    const item = this.items.get(id)
    if (!item) return undefined

    item.status = 'completed'
    item.completedAt = Date.now()

    if (this.currentTaskId === id) {
      this.currentTaskId = undefined
    }

    // Find and start next pending task
    const nextPending = Array.from(this.items.values()).find(i => i.status === 'pending')
    if (nextPending) {
      nextPending.status = 'in_progress'
      this.currentTaskId = nextPending.id
      return { completed: item, next: nextPending }
    }

    return { completed: item }
  }

  /**
   * Complete current task and move to next
   */
  completeCurrentAndNext(): { completed?: TodoItem; next?: TodoItem } {
    if (!this.currentTaskId) {
      // No current task, find first pending
      const pending = Array.from(this.items.values()).find(i => i.status === 'pending')
      if (pending) {
        pending.status = 'in_progress'
        this.currentTaskId = pending.id
        return { next: pending }
      }
      return {}
    }

    return this.completeTask(this.currentTaskId) || {}
  }

  /**
   * Check if all tasks are completed
   */
  isAllCompleted(): boolean {
    return Array.from(this.items.values()).every(i => i.status === 'completed')
  }

  /**
   * Get progress stats
   */
  getProgress(): { total: number; completed: number; pending: number; inProgress: number } {
    const items = Array.from(this.items.values())
    return {
      total: items.length,
      completed: items.filter(i => i.status === 'completed').length,
      pending: items.filter(i => i.status === 'pending').length,
      inProgress: items.filter(i => i.status === 'in_progress').length
    }
  }
}

/**
 * Create the __todo__ tool
 */
export function createTodoTool(manager: TodoManager): Tool {
  return {
    name: '__todo__',
    description: `Manage a todo list to track REAL tasks you are performing.

IMPORTANT: Only use for tasks YOU will actually execute using tools. Do NOT:
- Create fictional tasks you cannot perform (cooking, gym, etc.)
- Create tasks about what the USER is doing
- Mark tasks complete without actually doing work

Use this tool to:
- Track multi-step work YOU are doing (code changes, file edits, searches)
- Mark tasks complete AFTER you've actually performed them with other tools
- Show progress through complex technical tasks

Actions:
- "set": Create a list of tasks (only for work you'll do with tools)
- "complete": Mark current task done (only AFTER you've done it)
- "list": Show current progress

Items format:
- content: Task description (e.g., "Update config file")
- activeForm: Active form (e.g., "Updating config file")

Example (correct - actual work):
{ "action": "set", "items": [
  {"content": "Search for error handling", "activeForm": "Searching for error handling"},
  {"content": "Fix the bug in auth.ts", "activeForm": "Fixing the bug"},
  {"content": "Run tests", "activeForm": "Running tests"}
]}

WRONG - do NOT create:
- "Make breakfast" (you can't cook)
- "Go to gym" (you can't move)
- "User will review" (that's not your task)`,

    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['set', 'complete', 'list'],
          description: 'The action to perform'
        },
        items: {
          type: 'string',
          description: 'Array of task descriptions (for "set" action)'
        }
      },
      required: ['action']
    },

    execute: async (params) => {
      const { action, items: rawItems } = params as { action: string; items?: unknown }

      // Parse items - could be JSON string, array of strings, or array of objects
      type TodoInput = { content: string; activeForm?: string }
      let items: TodoInput[] | undefined

      if (rawItems) {
        let parsed: unknown = rawItems

        // Parse JSON string if needed
        if (typeof rawItems === 'string') {
          try {
            parsed = JSON.parse(rawItems)
          } catch {
            // Single string item
            parsed = [rawItems]
          }
        }

        // Convert to TodoInput array
        if (Array.isArray(parsed)) {
          items = parsed.map(item => {
            if (typeof item === 'string') {
              return { content: item }
            }
            if (typeof item === 'object' && item !== null && 'content' in item) {
              return {
                content: (item as { content: string }).content,
                activeForm: (item as { activeForm?: string }).activeForm
              }
            }
            return { content: String(item) }
          })
        }
      }

      switch (action) {
        case 'set': {
          if (!items || items.length === 0) {
            return { success: false, error: 'Items array is required for "set" action' }
          }

          const todos = manager.setAll(items)
          const current = manager.getCurrentTask()
          const currentLabel = current?.activeForm || current?.content

          return {
            success: true,
            data: {
              message: `Created ${todos.length} tasks. Starting: "${currentLabel}"`,
              todos: manager.getAll(),
              current: currentLabel
            }
          }
        }

        case 'complete': {
          const { completed, next } = manager.completeCurrentAndNext()

          if (!completed && !next) {
            return {
              success: true,
              data: {
                message: 'No tasks to complete.',
                todos: manager.getAll()
              }
            }
          }

          const progress = manager.getProgress()
          let message = ''

          if (completed) {
            message = `Completed: "${completed.content}". `
          }
          if (next) {
            const nextLabel = next.activeForm || next.content
            message += `Next: "${nextLabel}". `
          } else if (manager.isAllCompleted()) {
            message += 'All tasks completed!'
          }
          message += `Progress: ${progress.completed}/${progress.total}`

          const nextLabel = next ? (next.activeForm || next.content) : undefined

          return {
            success: true,
            data: {
              message,
              todos: manager.getAll(),
              current: nextLabel,
              progress
            }
          }
        }

        case 'list': {
          const todos = manager.getAll()
          const current = manager.getCurrentTask()
          const progress = manager.getProgress()
          const currentLabel = current ? (current.activeForm || current.content) : undefined

          return {
            success: true,
            data: {
              message: formatTodoList(todos),
              todos,
              current: currentLabel,
              progress
            }
          }
        }

        default:
          return { success: false, error: `Unknown action: ${action}` }
      }
    }
  }
}
