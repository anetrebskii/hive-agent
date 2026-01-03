/**
 * Context - A virtual filesystem for agent communication
 *
 * Enables tools and sub-agents to read/write shared data without passing
 * content through return values. Similar to how Claude Code uses the
 * actual filesystem for agent coordination.
 *
 * Usage:
 * ```typescript
 * const context = new Context()
 *
 * // Pre-populate before run
 * context.write('user/preferences', { theme: 'dark' })
 *
 * const result = await hive.run(message, { context })
 *
 * // Read results after run
 * const meals = context.read('meals/today')
 * ```
 */

export interface ContextEntry {
  value: unknown
  createdAt: number
  updatedAt: number
  /** Optional metadata about who wrote this entry */
  writtenBy?: string
}

export interface ContextListItem {
  path: string
  updatedAt: number
  writtenBy?: string
  /** Preview of value (for objects: type, for primitives: value) */
  preview: string
}

/**
 * Context provides a virtual filesystem for agent communication
 */
export class Context {
  private data: Map<string, ContextEntry> = new Map()

  /**
   * Write a value to the context at the given path
   *
   * @param path - Dot-separated path (e.g., 'meals.today', 'user.preferences')
   * @param value - Any JSON-serializable value
   * @param writtenBy - Optional identifier of who wrote this (tool name, agent name)
   */
  write(path: string, value: unknown, writtenBy?: string): void {
    const now = Date.now()
    const existing = this.data.get(path)

    this.data.set(path, {
      value,
      createdAt: existing?.createdAt || now,
      updatedAt: now,
      writtenBy
    })
  }

  /**
   * Read a value from the context
   *
   * @param path - Path to read from
   * @returns The value, or undefined if not found
   */
  read<T = unknown>(path: string): T | undefined {
    return this.data.get(path)?.value as T | undefined
  }

  /**
   * Check if a path exists in the context
   */
  has(path: string): boolean {
    return this.data.has(path)
  }

  /**
   * Delete a path from the context
   */
  delete(path: string): boolean {
    return this.data.delete(path)
  }

  /**
   * List all paths, optionally filtered by prefix
   *
   * @param prefix - Optional prefix to filter paths (e.g., 'meals' lists 'meals.today', 'meals.yesterday')
   * @returns Array of context items with metadata
   */
  list(prefix?: string): ContextListItem[] {
    const items: ContextListItem[] = []

    for (const [path, entry] of this.data) {
      if (prefix && !path.startsWith(prefix)) {
        continue
      }

      items.push({
        path,
        updatedAt: entry.updatedAt,
        writtenBy: entry.writtenBy,
        preview: this.getPreview(entry.value)
      })
    }

    // Sort by path for consistent ordering
    return items.sort((a, b) => a.path.localeCompare(b.path))
  }

  /**
   * Get all paths (just the keys, no metadata)
   */
  keys(prefix?: string): string[] {
    if (!prefix) {
      return Array.from(this.data.keys()).sort()
    }
    return Array.from(this.data.keys())
      .filter(k => k.startsWith(prefix))
      .sort()
  }

  /**
   * Clear all data from the context
   */
  clear(): void {
    this.data.clear()
  }

  /**
   * Get the full entry with metadata
   */
  getEntry(path: string): ContextEntry | undefined {
    return this.data.get(path)
  }

  /**
   * Export all data as a plain object
   */
  toObject(): Record<string, unknown> {
    const obj: Record<string, unknown> = {}
    for (const [path, entry] of this.data) {
      obj[path] = entry.value
    }
    return obj
  }

  /**
   * Import data from a plain object
   */
  fromObject(obj: Record<string, unknown>, writtenBy?: string): void {
    for (const [path, value] of Object.entries(obj)) {
      this.write(path, value, writtenBy)
    }
  }

  /**
   * Get number of entries
   */
  get size(): number {
    return this.data.size
  }

  private getPreview(value: unknown): string {
    if (value === null) return 'null'
    if (value === undefined) return 'undefined'

    const type = typeof value

    if (type === 'string') {
      const str = value as string
      return str.length > 50 ? `"${str.slice(0, 47)}..."` : `"${str}"`
    }

    if (type === 'number' || type === 'boolean') {
      return String(value)
    }

    if (Array.isArray(value)) {
      return `Array[${value.length}]`
    }

    if (type === 'object') {
      const keys = Object.keys(value as object)
      if (keys.length <= 3) {
        return `{${keys.join(', ')}}`
      }
      return `{${keys.slice(0, 3).join(', ')}, ...+${keys.length - 3}}`
    }

    return type
  }
}

/**
 * Create context tools for agents to interact with Context
 */
export function createContextTools(context: Context, agentName?: string): import('./types.js').Tool[] {
  return [
    {
      name: 'context_ls',
      description: `List all paths in the shared context, optionally filtered by prefix.

The shared context is a virtual filesystem where tools and agents can read/write data.
Use this to discover what data is available.

Examples:
- { } - list all paths
- { "prefix": "meals" } - list paths starting with "meals"`,
      parameters: {
        type: 'object',
        properties: {
          prefix: {
            type: 'string',
            description: 'Optional prefix to filter paths'
          }
        }
      },
      execute: async (params) => {
        const prefix = params.prefix as string | undefined
        const items = context.list(prefix)

        if (items.length === 0) {
          return {
            success: true,
            data: {
              message: prefix ? `No entries found with prefix "${prefix}"` : 'Context is empty',
              items: []
            }
          }
        }

        return {
          success: true,
          data: {
            count: items.length,
            items
          }
        }
      }
    },
    {
      name: 'context_read',
      description: `Read a value from the shared context.

Returns the stored value at the given path, or null if not found.

Examples:
- { "path": "meals.today" }
- { "path": "user.preferences" }`,
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'The path to read from'
          }
        },
        required: ['path']
      },
      execute: async (params) => {
        const path = params.path as string
        const entry = context.getEntry(path)

        if (!entry) {
          return {
            success: true,
            data: {
              found: false,
              path,
              value: null
            }
          }
        }

        return {
          success: true,
          data: {
            found: true,
            path,
            value: entry.value,
            updatedAt: entry.updatedAt,
            writtenBy: entry.writtenBy
          }
        }
      }
    },
    {
      name: 'context_write',
      description: `Write a value to the shared context.

Use this to store data that should be available to other tools, agents, or after the run completes.

Examples:
- { "path": "meals.today", "value": { "breakfast": "eggs", "calories": 200 } }
- { "path": "analysis.result", "value": "The data shows positive trends" }`,
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'The path to write to'
          },
          value: {
            type: 'string',
            description: 'The value to store (any JSON value)'
          }
        },
        required: ['path', 'value']
      },
      execute: async (params) => {
        const path = params.path as string
        const value = params.value

        context.write(path, value, agentName)

        return {
          success: true,
          data: {
            path,
            written: true
          }
        }
      }
    }
  ]
}
