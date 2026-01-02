/**
 * System Prompt Builder
 *
 * Utilities for building dynamic system prompts with environment info and reminders.
 */

import type { SystemPromptConfig, EnvironmentInfo, SubAgentConfig } from './types.js'

/**
 * Build environment section for system prompt
 */
export function buildEnvironmentSection(env: EnvironmentInfo): string {
  const lines: string[] = []

  if (env.workingDirectory) {
    lines.push(`Working directory: ${env.workingDirectory}`)
  }
  if (env.platform) {
    lines.push(`Platform: ${env.platform}`)
  }
  if (env.date) {
    lines.push(`Today's date: ${env.date}`)
  }
  if (env.customVars) {
    for (const [key, value] of Object.entries(env.customVars)) {
      lines.push(`${key}: ${value}`)
    }
  }

  if (lines.length === 0) {
    return ''
  }

  return `\n<env>\n${lines.join('\n')}\n</env>`
}

/**
 * Build reminder section for system prompt
 */
export function buildRemindersSection(reminders: string[]): string {
  if (reminders.length === 0) {
    return ''
  }

  return reminders
    .map(reminder => `\n<system-reminder>\n${reminder}\n</system-reminder>`)
    .join('')
}

/**
 * Build agent list section for __task__ tool description
 */
export function buildAgentListSection(agents: SubAgentConfig[]): string {
  if (agents.length === 0) {
    return ''
  }

  const lines = agents.map(agent => `- ${agent.name}: ${agent.description}`)
  return `\nAvailable agents:\n${lines.join('\n')}`
}

/**
 * Build complete system prompt from config
 */
export function buildSystemPrompt(config: SystemPromptConfig): string {
  let prompt = config.basePrompt

  if (config.environment) {
    prompt += buildEnvironmentSection(config.environment)
  }

  if (config.reminders && config.reminders.length > 0) {
    prompt += buildRemindersSection(config.reminders)
  }

  return prompt
}

/**
 * Get current environment info
 */
export function getCurrentEnvironment(): EnvironmentInfo {
  return {
    workingDirectory: process.cwd(),
    platform: process.platform,
    date: new Date().toISOString().split('T')[0]
  }
}

/**
 * Default system prompt template
 */
export const DEFAULT_SYSTEM_PROMPT = `You are a helpful AI assistant.

You have access to tools that allow you to perform various tasks. Use them when needed to help the user.

When you need clarification from the user, use the __ask_user__ tool to ask a question.

Be concise and helpful in your responses.`
