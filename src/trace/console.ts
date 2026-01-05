/**
 * Console Trace Provider - Logs trace events to console
 */

import type {
  Trace,
  TraceProvider,
  AgentSpan,
  LLMCallEvent,
  ToolCallEvent,
  ModelPricing
} from './types.js'

export interface ConsoleTraceConfig {
  /** Show LLM calls */
  showLLMCalls?: boolean
  /** Show tool calls */
  showToolCalls?: boolean
  /** Show cost breakdown */
  showCosts?: boolean
  /** Show input/output messages for agents */
  showMessages?: boolean
  /** Max length for message previews (default: 80) */
  maxMessageLength?: number
  /** Indentation string */
  indent?: string
  /** Use colors (ANSI) */
  colors?: boolean
  /** Custom model pricing for cost calculation (overrides defaults) */
  modelPricing?: Record<string, ModelPricing>
}

/**
 * Console trace provider - logs trace events to console
 */
export class ConsoleTraceProvider implements TraceProvider {
  private config: Omit<Required<ConsoleTraceConfig>, 'modelPricing'>
  readonly modelPricing?: Record<string, ModelPricing>

  constructor(config: ConsoleTraceConfig = {}) {
    this.config = {
      showLLMCalls: config.showLLMCalls ?? true,
      showToolCalls: config.showToolCalls ?? true,
      showCosts: config.showCosts ?? true,
      showMessages: config.showMessages ?? true,
      maxMessageLength: config.maxMessageLength ?? 80,
      indent: config.indent ?? '  ',
      colors: config.colors ?? true
    }
    this.modelPricing = config.modelPricing
  }

  private truncate(text: string | undefined, maxLength?: number): string {
    if (!text) return ''
    const max = maxLength ?? this.config.maxMessageLength
    // Replace newlines with spaces for single-line display
    const singleLine = text.replace(/\n/g, ' ').trim()
    if (singleLine.length <= max) return singleLine
    return singleLine.slice(0, max - 3) + '...'
  }

  private getIndent(depth: number): string {
    return this.config.indent.repeat(depth)
  }

  private formatCost(cost: number): string {
    return `$${cost.toFixed(6)}`
  }

  private color(text: string, code: string): string {
    if (!this.config.colors) return text
    return `\x1b[${code}m${text}\x1b[0m`
  }

  /**
   * Get the path from root to span as "parent → child → current"
   */
  private getPath(span: AgentSpan): string {
    const names: string[] = []
    let current: AgentSpan | undefined = span
    while (current) {
      names.unshift(current.agentName)
      current = current.parent
    }
    return names.join(' → ')
  }

  onTraceStart(trace: Trace): void {
    console.log(this.color(`\n━━━ Trace: ${trace.traceId} ━━━`, '1;36'))
  }

  onTraceEnd(trace: Trace): void {
    console.log(this.color(`\n━━━ Trace Complete ━━━`, '1;36'))
    console.log(`Duration: ${trace.durationMs}ms`)
    console.log(`Total LLM calls: ${trace.totalLLMCalls}`)
    console.log(`Total tool calls: ${trace.totalToolCalls}`)

    // Show tokens with cache breakdown
    let tokenLine = `Total tokens: ${trace.totalInputTokens} in / ${trace.totalOutputTokens} out`
    if (trace.totalCacheCreationTokens || trace.totalCacheReadTokens) {
      tokenLine += ` [cache: +${trace.totalCacheCreationTokens} write, ${trace.totalCacheReadTokens} read]`
    }
    console.log(tokenLine)

    if (this.config.showCosts) {
      console.log(this.color(`Total cost: ${this.formatCost(trace.totalCost)}`, '1;33'))

      if (Object.keys(trace.costByModel).length > 1) {
        console.log('\nCost by model:')
        for (const [modelId, data] of Object.entries(trace.costByModel)) {
          let line = `  ${modelId}: ${this.formatCost(data.cost)} (${data.calls} calls, ${data.inputTokens}/${data.outputTokens} tokens`
          if (data.cacheReadTokens) {
            line += `, ${data.cacheReadTokens} cached`
          }
          line += ')'
          console.log(line)
        }
      }
    }
    console.log('')
  }

  onAgentStart(span: AgentSpan, _trace: Trace): void {
    const indent = this.getIndent(span.depth)
    const icon = span.depth === 0 ? '🤖' : '🔹'
    const path = span.depth > 0 ? this.color(this.getPath(span), '2') : this.color(span.agentName, '1;32')
    let line = `${indent}${icon} ${path} started`

    // Show input message preview if available and enabled
    if (this.config.showMessages && span.inputMessage) {
      const preview = this.truncate(span.inputMessage)
      line += `\n${indent}   ${this.color('↳', '2')} ${this.color(preview, '2')}`
    }

    console.log(line)
  }

  onAgentEnd(span: AgentSpan, _trace: Trace): void {
    const indent = this.getIndent(span.depth)
    const status = span.status === 'complete' ? '✓' :
                   span.status === 'error' ? '✗' : '⚠'
    const statusColor = span.status === 'complete' ? '32' :
                        span.status === 'error' ? '31' : '33'
    const path = span.depth > 0 ? this.getPath(span) : span.agentName

    let line = `${indent}${this.color(status, statusColor)} ${path} completed`
    line += ` (${span.durationMs}ms`

    if (this.config.showCosts && span.totalCost > 0) {
      line += `, ${this.formatCost(span.totalCost)}`
    }
    line += ')'

    // Show output response preview if available and enabled
    if (this.config.showMessages && span.outputResponse) {
      const preview = this.truncate(span.outputResponse)
      line += `\n${indent}   ${this.color('↳', '2')} ${this.color(preview, '2')}`
    }

    console.log(line)
  }

  onLLMCall(event: LLMCallEvent, span: AgentSpan, _trace: Trace): void {
    if (!this.config.showLLMCalls) return

    const indent = this.getIndent(span.depth + 1)
    const path = this.color(this.getPath(span), '2')
    let line = `${indent}${this.color('⚡', '33')} ${path} → LLM: ${event.modelId}`
    line += ` (${event.inputTokens}/${event.outputTokens} tokens`
    if (event.cacheReadTokens) {
      line += ` +${event.cacheReadTokens} cached`
    }
    line += `, ${event.durationMs}ms`

    if (this.config.showCosts) {
      line += `, ${this.formatCost(event.cost)}`
    }
    line += ')'

    console.log(line)
  }

  onToolCall(event: ToolCallEvent, span: AgentSpan, _trace: Trace): void {
    if (!this.config.showToolCalls) return

    const indent = this.getIndent(span.depth + 1)
    const path = this.color(this.getPath(span), '2')
    const status = event.output.success ? this.color('✓', '32') : this.color('✗', '31')
    console.log(`${indent}${this.color('🔧', '35')} ${path} → ${event.toolName} ${status} (${event.durationMs}ms)`)
  }
}
