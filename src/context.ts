/**
 * Context - A virtual filesystem for agent communication
 *
 * Enables tools and sub-agents to read/write shared data without passing
 * content through return values. Similar to how Claude Code uses the
 * actual filesystem for agent coordination.
 *
 * Usage:
 * ```typescript
 * const context = new Context({
 *   schemas: {
 *     'plan/current': {
 *       type: 'object',
 *       properties: {
 *         title: { type: 'string' },
 *         days: { type: 'array' }
 *       },
 *       required: ['title', 'days']
 *     }
 *   }
 * })
 *
 * // Pre-populate before run
 * context.write('user/preferences', { theme: 'dark' })
 *
 * const result = await hive.run(message, { context })
 *
 * // Read results after run (validated against schema)
 * const plan = context.read('plan/current')
 * ```
 */

import type { JSONSchema } from './types.js'

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

/** Custom validator function */
export type ValidatorFn = (value: unknown) => ValidationError[] | null

/** Zod-like schema interface (duck typing to avoid hard dependency) */
export interface ZodLike {
  safeParse(value: unknown): { success: true; data: unknown } | { success: false; error: { errors: Array<{ path: (string | number)[]; message: string }> } }
}

export interface ContextSchema {
  /** JSON Schema for validation (use for .schema paths) */
  schema?: JSONSchema
  /** Custom validator function (use for .validate paths) */
  validate?: ValidatorFn
  /** Zod schema for validation (use for .zod paths) */
  zod?: ZodLike
  /** Description shown to AI about what this path expects */
  description?: string
}

export interface ContextConfig {
  /**
   * Validators for context paths. Extension in path determines validation:
   *
   * Format extensions (basic validation):
   * - 'path/name.json' → validates valid JSON object/array
   * - 'path/name.md' → validates string (markdown)
   * - 'path/name.txt' → validates string
   * - 'path/name.num' → validates number
   * - 'path/name.bool' → validates boolean
   *
   * Schema extensions (with validator value):
   * - 'path/name.schema' → JSON Schema validation
   * - 'path/name.zod' → Zod schema validation
   * - 'path/name.validate' → Custom validator function
   */
  validators?: Record<string, JSONSchema | ValidatorFn | ZodLike | ContextSchema | null>
}

export interface ValidationError {
  path: string
  message: string
  expected?: string
  received?: string
}

export interface WriteResult {
  success: boolean
  errors?: ValidationError[]
}

/** Supported format extensions */
type FormatExt = 'json' | 'md' | 'txt' | 'num' | 'bool'
type SchemaExt = 'schema' | 'zod' | 'validate'
type ValidatorType = FormatExt | SchemaExt

interface ValidatorEntry {
  type: ValidatorType
  schema?: JSONSchema
  validate?: ValidatorFn
  zod?: ZodLike
  description?: string
}

/**
 * Context provides a virtual filesystem for agent communication
 */
export class Context {
  private data: Map<string, ContextEntry> = new Map()
  private validators: Map<string, ValidatorEntry> = new Map()

  /** Extension to type mapping */
  private static readonly EXT_MAP: Record<string, ValidatorType> = {
    '.json': 'json',
    '.md': 'md',
    '.txt': 'txt',
    '.num': 'num',
    '.bool': 'bool',
    '.schema': 'schema',
    '.zod': 'zod',
    '.validate': 'validate'
  }

  constructor(config?: ContextConfig) {
    if (config?.validators) {
      for (const [key, value] of Object.entries(config.validators)) {
        this.registerValidator(key, value)
      }
    }
  }

  /**
   * Register a validator for a path (can also be called after construction)
   *
   * For paths with format extensions (.json, .md, etc.), the validator adds
   * additional validation on top of the basic format check.
   *
   * @example
   * // Basic format validation only
   * context.registerValidator('data/config.json', null)
   *
   * // Format + JSON Schema validation
   * context.registerValidator('data/config.json', { type: 'object', properties: {...} })
   *
   * // Format + Zod validation
   * context.registerValidator('data/user.json', z.object({ name: z.string() }))
   */
  registerValidator(key: string, value: JSONSchema | ValidatorFn | ZodLike | ContextSchema | null): void {
    // Keep the full path (with extension) as the key
    const path = key

    if (!value) {
      // Just register the path for format validation (no additional validator)
      return
    }

    // Determine validator type from value
    if (typeof value === 'function') {
      this.validators.set(path, { type: 'validate', validate: value })
    } else if (this.isZodLike(value)) {
      this.validators.set(path, { type: 'zod', zod: value })
    } else if ('type' in value && value.type === 'object') {
      this.validators.set(path, { type: 'schema', schema: value as JSONSchema })
    } else if ('schema' in value || 'validate' in value || 'zod' in value) {
      const cs = value as ContextSchema
      if (cs.zod) {
        this.validators.set(path, { type: 'zod', zod: cs.zod, description: cs.description })
      } else if (cs.validate) {
        this.validators.set(path, { type: 'validate', validate: cs.validate, description: cs.description })
      } else if (cs.schema) {
        this.validators.set(path, { type: 'schema', schema: cs.schema, description: cs.description })
      }
    }
  }

  /** Parse path and extension */
  private parsePathExt(key: string): { path: string; ext: ValidatorType | null } {
    for (const [suffix, type] of Object.entries(Context.EXT_MAP)) {
      if (key.endsWith(suffix)) {
        return { path: key.slice(0, -suffix.length), ext: type }
      }
    }
    return { path: key, ext: null }
  }

  /** Check if extension is a format type */
  private isFormatExt(ext: ValidatorType): ext is FormatExt {
    return ['json', 'md', 'txt', 'num', 'bool'].includes(ext)
  }

  /** Check if value looks like a Zod schema */
  private isZodLike(value: unknown): value is ZodLike {
    return (
      typeof value === 'object' &&
      value !== null &&
      'safeParse' in value &&
      typeof (value as ZodLike).safeParse === 'function'
    )
  }

  /**
   * Write a value to the context at the given path
   *
   * @param path - Dot-separated path (e.g., 'meals.today', 'user.preferences')
   * @param value - Any JSON-serializable value
   * @param writtenBy - Optional identifier of who wrote this (tool name, agent name)
   * @returns WriteResult with success status and any validation errors
   */
  write(path: string, value: unknown, writtenBy?: string): WriteResult {
    const { ext } = this.parsePathExt(path)
    const validator = this.validators.get(path)
    let errors: ValidationError[] = []

    // Step 1: Format validation (from extension)
    if (ext && this.isFormatExt(ext)) {
      errors = this.validateFormat(value, ext, path)
      if (errors.length > 0) {
        return { success: false, errors }
      }
    }

    // Step 2: Additional validation (from registered validator)
    if (validator) {
      if (validator.validate) {
        const result = validator.validate(value)
        if (result && result.length > 0) {
          errors = result
        }
      } else if (validator.schema) {
        errors = this.validateSchema(value, validator.schema, path)
      } else if (validator.zod) {
        errors = this.validateZod(value, validator.zod, path)
      }
    }

    if (errors.length > 0) {
      return { success: false, errors }
    }

    const now = Date.now()
    const existing = this.data.get(path)

    this.data.set(path, {
      value,
      createdAt: existing?.createdAt || now,
      updatedAt: now,
      writtenBy
    })

    return { success: true }
  }

  /**
   * Get validator info for a path
   */
  getValidator(path: string): { type: ValidatorType; schema?: JSONSchema; description?: string } | undefined {
    const v = this.validators.get(path)
    if (!v) return undefined
    return { type: v.type, schema: v.schema, description: v.description }
  }

  /**
   * Get schema for a path (if JSON schema validator)
   */
  getSchema(path: string): JSONSchema | undefined {
    const v = this.validators.get(path)
    return v?.schema
  }

  /**
   * Get validator description for a path
   */
  getValidatorDescription(path: string): string | undefined {
    return this.validators.get(path)?.description
  }

  /**
   * Get all paths with validators
   */
  getValidatorPaths(): string[] {
    return Array.from(this.validators.keys())
  }

  /**
   * Validate a value against a JSON schema
   */
  private validateSchema(value: unknown, schema: JSONSchema, basePath: string): ValidationError[] {
    const errors: ValidationError[] = []

    // Type check
    if (schema.type === 'object') {
      if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        errors.push({
          path: basePath,
          message: 'Expected object',
          expected: 'object',
          received: value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value
        })
        return errors
      }

      const obj = value as Record<string, unknown>

      // Check required properties
      if (schema.required) {
        for (const prop of schema.required) {
          if (!(prop in obj)) {
            errors.push({
              path: `${basePath}.${prop}`,
              message: `Missing required property: ${prop}`,
              expected: 'present'
            })
          }
        }
      }

      // Validate properties
      if (schema.properties) {
        for (const [prop, propSchema] of Object.entries(schema.properties)) {
          if (prop in obj) {
            const propErrors = this.validateProperty(obj[prop], propSchema, `${basePath}.${prop}`)
            errors.push(...propErrors)
          }
        }
      }
    }

    return errors
  }

  /**
   * Validate a single property
   */
  private validateProperty(
    value: unknown,
    schema: { type: string; enum?: string[]; items?: JSONSchema },
    path: string
  ): ValidationError[] {
    const errors: ValidationError[] = []

    // Type validation
    if (schema.type === 'string') {
      if (typeof value !== 'string') {
        errors.push({
          path,
          message: 'Expected string',
          expected: 'string',
          received: typeof value
        })
      } else if (schema.enum && !schema.enum.includes(value)) {
        errors.push({
          path,
          message: `Value must be one of: ${schema.enum.join(', ')}`,
          expected: schema.enum.join(' | '),
          received: value
        })
      }
    } else if (schema.type === 'number') {
      if (typeof value !== 'number') {
        errors.push({
          path,
          message: 'Expected number',
          expected: 'number',
          received: typeof value
        })
      }
    } else if (schema.type === 'boolean') {
      if (typeof value !== 'boolean') {
        errors.push({
          path,
          message: 'Expected boolean',
          expected: 'boolean',
          received: typeof value
        })
      }
    } else if (schema.type === 'array') {
      if (!Array.isArray(value)) {
        errors.push({
          path,
          message: 'Expected array',
          expected: 'array',
          received: typeof value
        })
      }
      // Could add items validation here if needed
    } else if (schema.type === 'object') {
      if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        errors.push({
          path,
          message: 'Expected object',
          expected: 'object',
          received: value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value
        })
      }
    }

    return errors
  }

  /**
   * Validate a value using Zod schema
   */
  private validateZod(value: unknown, zod: ZodLike, basePath: string): ValidationError[] {
    const result = zod.safeParse(value)

    if (result.success) {
      return []
    }

    return result.error.errors.map(err => ({
      path: err.path.length > 0 ? `${basePath}.${err.path.join('.')}` : basePath,
      message: err.message
    }))
  }

  /**
   * Validate a value against a format extension
   */
  private validateFormat(value: unknown, format: FormatExt, path: string): ValidationError[] {
    switch (format) {
      case 'json':
        // Must be object or array (valid JSON structure)
        if (typeof value !== 'object' || value === null) {
          return [{
            path,
            message: 'Expected JSON object or array',
            expected: 'object | array',
            received: value === null ? 'null' : typeof value
          }]
        }
        return []

      case 'md':
      case 'txt':
        // Must be string
        if (typeof value !== 'string') {
          return [{
            path,
            message: `Expected string for .${format}`,
            expected: 'string',
            received: typeof value
          }]
        }
        return []

      case 'num':
        // Must be number
        if (typeof value !== 'number' || Number.isNaN(value)) {
          return [{
            path,
            message: 'Expected number',
            expected: 'number',
            received: Number.isNaN(value) ? 'NaN' : typeof value
          }]
        }
        return []

      case 'bool':
        // Must be boolean
        if (typeof value !== 'boolean') {
          return [{
            path,
            message: 'Expected boolean',
            expected: 'boolean',
            received: typeof value
          }]
        }
        return []

      default:
        return []
    }
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
  // Build validator info for tool descriptions
  const validatorPaths = context.getValidatorPaths()
  const validatorInfo = validatorPaths.length > 0
    ? `\n\nPaths with validation:\n${validatorPaths.map(p => {
        const v = context.getValidator(p)
        const desc = v?.description || (v?.type === 'schema' ? 'JSON Schema' : 'custom validator')
        return `- ${p}: ${desc}`
      }).join('\n')}`
    : ''

  return [
    {
      name: 'context_ls',
      description: `List all paths in the context, optionally filtered by prefix.

The context is a virtual filesystem where tools and agents can read/write data.
Use this to discover what data is available.${validatorInfo}

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

        // Include validator info in response
        const validators = context.getValidatorPaths()
          .filter(p => !prefix || p.startsWith(prefix))
          .map(p => {
            const v = context.getValidator(p)
            return {
              path: p,
              type: v?.type,
              description: v?.description,
              schema: v?.schema
            }
          })

        if (items.length === 0 && validators.length === 0) {
          return {
            success: true,
            data: {
              message: prefix ? `No entries found with prefix "${prefix}"` : 'Context is empty',
              items: [],
              validators: []
            }
          }
        }

        return {
          success: true,
          data: {
            count: items.length,
            items,
            validators: validators.length > 0 ? validators : undefined
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
      description: `Write a value to the context.

Use this to store data that should be available to other tools, agents, or after the run completes.
Some paths have validators - if validation fails, you'll get an error with details.${validatorInfo}

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

        const result = context.write(path, value, agentName)

        if (!result.success) {
          // Get schema for helpful error message
          const schema = context.getSchema(path)
          return {
            success: false,
            error: 'Validation failed',
            data: {
              path,
              errors: result.errors,
              expectedSchema: schema
            }
          }
        }

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
