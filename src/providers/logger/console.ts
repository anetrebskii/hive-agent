/**
 * Console Logger Provider
 *
 * Default logger implementation using console.
 */

import type { LogProvider, ToolResult, AgentResult } from '../../types.js'

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

export interface ConsoleLoggerConfig {
  level?: LogLevel
  prefix?: string
  timestamps?: boolean
}

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3
}

export class ConsoleLogger implements LogProvider {
  private level: number
  private prefix: string
  private timestamps: boolean

  constructor(config: ConsoleLoggerConfig = {}) {
    this.level = LOG_LEVELS[config.level || 'info']
    this.prefix = config.prefix || '[Hive]'
    this.timestamps = config.timestamps ?? true
  }

  private formatMessage(level: LogLevel, message: string): string {
    const parts: string[] = []
    if (this.timestamps) {
      parts.push(new Date().toISOString())
    }
    parts.push(this.prefix)
    parts.push(`[${level.toUpperCase()}]`)
    parts.push(message)
    return parts.join(' ')
  }

  private shouldLog(level: LogLevel): boolean {
    return LOG_LEVELS[level] >= this.level
  }

  debug(message: string, data?: unknown): void {
    if (this.shouldLog('debug')) {
      console.debug(this.formatMessage('debug', message), data ?? '')
    }
  }

  info(message: string, data?: unknown): void {
    if (this.shouldLog('info')) {
      console.info(this.formatMessage('info', message), data ?? '')
    }
  }

  warn(message: string, data?: unknown): void {
    if (this.shouldLog('warn')) {
      console.warn(this.formatMessage('warn', message), data ?? '')
    }
  }

  error(message: string, data?: unknown): void {
    if (this.shouldLog('error')) {
      console.error(this.formatMessage('error', message), data ?? '')
    }
  }

  onToolCall(toolName: string, params: unknown): void {
    this.debug(`Tool call: ${toolName}`, params)
  }

  onToolResult(toolName: string, result: ToolResult, durationMs: number): void {
    const status = result.success ? 'success' : 'error'
    this.debug(`Tool result: ${toolName} (${status}, ${durationMs}ms)`, result)
  }

  onIteration(iteration: number, messageCount: number): void {
    this.debug(`Iteration ${iteration}, messages: ${messageCount}`)
  }

  onComplete(result: AgentResult): void {
    this.info(`Agent completed: ${result.status}`, {
      toolCalls: result.toolCalls.length,
      usage: result.usage
    })
  }
}
