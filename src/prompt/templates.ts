/**
 * Prompt Templates
 *
 * Template functions for generating prompt sections.
 */

import type {
  SubAgentDef,
  ToolDef,
  ContextPathDef,
  TaskExample,
  WorkflowStep,
  OutputFormat,
  OutputSchema,
  ChecklistConfig,
  SubAgentExample
} from './types.js'

// ============================================================================
// Main Agent Templates
// ============================================================================

/**
 * Generate role section
 */
export function roleSection(role: string, description?: string): string {
  let section = `You are ${role}.`
  if (description) {
    section += ` ${description}`
  }
  return section
}

/**
 * Generate sub-agents table
 */
export function subAgentsTable(agents: SubAgentDef[]): string {
  if (agents.length === 0) return ''

  const lines = [
    '## Available Sub-Agents',
    '',
    '| Agent | Purpose | When to Use |',
    '|-------|---------|-------------|'
  ]

  for (const agent of agents) {
    lines.push(`| **${agent.name}** | ${agent.purpose} | ${agent.whenToUse} |`)
  }

  return lines.join('\n')
}

/**
 * Generate sub-agent parameters documentation
 */
export function subAgentParametersSection(agents: SubAgentDef[]): string {
  // Only include agents that have input parameters
  const agentsWithParams = agents.filter(a => a.inputParams && a.inputParams.length > 0)
  if (agentsWithParams.length === 0) return ''

  const lines = [
    '## Sub-Agent Parameters',
    '',
    '⚠️ IMPORTANT: Before calling a sub-agent, gather ALL required information from the user.',
    'Use __ask_user__ to collect missing parameters, then call the sub-agent with complete data.',
    ''
  ]

  for (const agent of agentsWithParams) {
    lines.push(`### ${agent.name}`)
    lines.push('')
    for (const param of agent.inputParams!) {
      const required = param.required ? '(required)' : '(optional)'
      lines.push(`- **${param.name}** ${required}: ${param.description}`)
    }
    lines.push('')
  }

  return lines.join('\n')
}

/**
 * Generate question handling section
 */
export function questionHandlingSection(
  description?: string,
  exampleFlow?: string[]
): string {
  const lines = ['## Handling Sub-Agent Questions', '']

  if (description) {
    lines.push(description, '')
  }

  lines.push(
    'When a sub-agent returns status "needs_input" with questions:',
    '',
    '1. **Check conversation history first** - the user may have already provided this information',
    '   - Look through earlier messages for relevant answers',
    '   - If found, call the sub-agent again with that information',
    '',
    '2. **Only ask if not in history** - if the information is NOT in conversation history:',
    '   - Call the __ask_user__ tool with those questions',
    '   - After user answers, call the sub-agent again with the answers',
    '',
    '⚠️ CRITICAL:',
    '- Do NOT ask the user for information they already provided in the conversation',
    '- Make actual tool calls, never write tool names as text',
    '- Do NOT output JSON - use the tool interface',
    ''
  )

  if (exampleFlow && exampleFlow.length > 0) {
    lines.push('Example flow:')
    for (const step of exampleFlow) {
      lines.push(`- ${step}`)
    }
  }

  return lines.join('\n')
}

/**
 * Generate direct tools section
 */
export function directToolsSection(tools: ToolDef[]): string {
  if (tools.length === 0) return ''

  const lines = ['## Direct Tools', '']
  for (const tool of tools) {
    lines.push(`- **${tool.name}** - ${tool.description}`)
  }
  return lines.join('\n')
}

/**
 * Generate context storage section
 */
export function contextStorageSection(paths: ContextPathDef[]): string {
  if (paths.length === 0) return ''

  const lines = ['## Context Storage', '']
  for (const path of paths) {
    lines.push(`- ${path.path} - ${path.description}`)
  }
  return lines.join('\n')
}

/**
 * Generate rules section
 */
export function rulesSection(rules: string[]): string {
  if (rules.length === 0) return ''

  const lines = ['## Rules', '']
  for (const rule of rules) {
    lines.push(`- ${rule}`)
  }
  return lines.join('\n')
}

/**
 * Generate task examples section
 */
export function taskExamplesSection(examples: TaskExample[]): string {
  if (examples.length === 0) return ''

  const lines = ['## Task Examples', '']
  for (const example of examples) {
    lines.push(`**User:** "${example.userInput}"`)
    lines.push(`**Action:** ${example.action}`)
    lines.push(`**Result:** ${example.result}`)
    lines.push('')
  }
  return lines.join('\n')
}

// ============================================================================
// Sub-Agent Templates
// ============================================================================

/**
 * Generate sub-agent role section
 */
export function subAgentRoleSection(role: string): string {
  return `You are ${role}.`
}

/**
 * Generate input parameters section - explains how to check provided parameters
 */
export function inputParametersSection(): string {
  return `## Before Asking Questions

⚠️ IMPORTANT: Check these sources FIRST before using __ask_user__:

1. **Check your input parameters** - values like goal, dailyCalories, days may already be provided
2. **Check context** - use context_ls and context_read to find stored information
3. **Only ask if truly missing** - use __ask_user__ ONLY when info is not in input or context

NEVER ask for information that was already provided or exists in context.`
}

/**
 * Generate task section
 */
export function taskSection(task: string): string {
  return `Your task: ${task}`
}

/**
 * Generate workflow steps section
 */
export function workflowSection(steps: WorkflowStep[]): string {
  if (steps.length === 0) return ''

  const lines: string[] = []

  steps.forEach((step, index) => {
    lines.push(`## Step ${index + 1}: ${step.description}`)
    lines.push('')

    if (step.askQuestion) {
      const { condition, question, options } = step.askQuestion
      if (condition) {
        // Make it explicit to check input parameters
        lines.push(`${condition} (check your input parameters first!), use __ask_user__ to ask:`)
      } else {
        lines.push('Use __ask_user__ to ask:')
      }
      lines.push(`"${question}"`)
      if (options && options.length > 0) {
        lines.push(`Options: ${options.join(', ')}`)
      }
      lines.push('')
    }

    if (step.toolCalls && step.toolCalls.length > 0) {
      for (const call of step.toolCalls) {
        lines.push(`- ${call}`)
      }
      lines.push('')
    }
  })

  return lines.join('\n')
}

/**
 * Generate guidelines section
 */
export function guidelinesSection(guidelines: string[]): string {
  if (guidelines.length === 0) return ''

  const lines = ['## Guidelines', '']
  for (const guideline of guidelines) {
    lines.push(`- ${guideline}`)
  }
  return lines.join('\n')
}

/**
 * Generate output section
 */
export function outputSection(output: OutputFormat): string {
  const lines = ['## Output', '']

  lines.push('When done, call __output__ with:')
  lines.push(`- summary: ${output.summaryTemplate}`)

  const dataFields = Object.entries(output.dataFields)
    .map(([k, v]) => `${k}: ${v}`)
    .join(', ')
  lines.push(`- data: { ${dataFields} }`)

  if (output.errorCase) {
    lines.push('')
    lines.push(`If ${output.errorCase.condition}:`)
    lines.push(`- data: ${JSON.stringify(output.errorCase.data)}`)
  }

  return lines.join('\n')
}

/**
 * Generate output section from JSON schema
 */
export function outputSchemaSection(schema: OutputSchema): string {
  const lines = ['## Output', '']

  lines.push('When done, call __output__ with:')
  lines.push('- summary: Brief description of what was accomplished')
  lines.push('- data: Object matching this schema:')
  lines.push('')

  if (schema.properties) {
    lines.push('```')
    lines.push('{')
    const props = Object.entries(schema.properties)
    props.forEach(([name, prop], index) => {
      const isRequired = schema.required?.includes(name)
      const typeStr = prop.type || 'any'
      const descStr = prop.description ? ` // ${prop.description}` : ''
      const requiredMark = isRequired ? '' : '?'
      const comma = index < props.length - 1 ? ',' : ''
      lines.push(`  "${name}"${requiredMark}: ${typeStr}${comma}${descStr}`)
    })
    lines.push('}')
    lines.push('```')
  }

  if (schema.required && schema.required.length > 0) {
    lines.push('')
    lines.push(`Required: ${schema.required.join(', ')}`)
  }

  return lines.join('\n')
}

/**
 * Generate available tools section for sub-agents
 */
export function availableToolsSection(tools: ToolDef[]): string {
  if (tools.length === 0) return ''

  const lines = ['## Available Tools', '']
  for (const tool of tools) {
    lines.push(`- **${tool.name}**: ${tool.description}`)
  }
  return lines.join('\n')
}

/**
 * Generate instructions section
 */
export function instructionsSection(instructions: string[]): string {
  if (instructions.length === 0) return ''

  const lines = ['## Instructions', '']
  instructions.forEach((instruction, index) => {
    lines.push(`${index + 1}. ${instruction}`)
  })
  return lines.join('\n')
}

/**
 * Generate checklist section
 */
export function checklistSection(config: ChecklistConfig): string {
  const lines = ['## Task Tracking', '']

  // When trackProgress is enabled, instruct to use the __todo__ tool
  if (config.trackProgress) {
    lines.push('Use the __todo__ tool to plan and track your work.')
    lines.push('Create your own todos based on the task. Example items you might track:')
    lines.push('')

    for (const item of config.items) {
      const optional = item.optional ? ' (optional)' : ''
      lines.push(`- ${item.task}${optional}`)
    }

    lines.push('')
    lines.push('Mark each todo as in_progress when starting, then completed when done.')
  } else {
    // Static checklist without todo tracking - just guidance
    lines.push('Consider these aspects:')
    lines.push('')

    for (const item of config.items) {
      const optional = item.optional ? ' (optional)' : ''
      lines.push(`- ${item.task}${optional}`)
    }
  }

  return lines.join('\n')
}

/**
 * Generate examples section for sub-agents
 */
export function subAgentExamplesSection(examples: SubAgentExample[]): string {
  if (examples.length === 0) return ''

  const lines = ['## Examples', '']

  examples.forEach((example, index) => {
    if (examples.length > 1) {
      lines.push(`### Example ${index + 1}`)
      lines.push('')
    }
    lines.push(`**Input:** ${example.input}`)
    lines.push(`**Output:** ${example.output}`)
    if (example.explanation) {
      lines.push(`**Why:** ${example.explanation}`)
    }
    lines.push('')
  })

  return lines.join('\n')
}

/**
 * Generate constraints section
 */
export function constraintsSection(constraints: string[]): string {
  if (constraints.length === 0) return ''

  const lines = ['## Constraints', '']
  for (const constraint of constraints) {
    lines.push(`- ❌ ${constraint}`)
  }
  return lines.join('\n')
}
