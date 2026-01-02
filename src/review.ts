/**
 * Review System
 *
 * Provides self-review capabilities for agents to improve quality.
 */

import type {
  Tool,
  ReviewResult,
  ReviewIssue,
  ReviewSeverity,
  ReviewConfig
} from './types.js'

/**
 * Default review categories
 */
export const DEFAULT_REVIEW_CATEGORIES = [
  'completeness',
  'correctness',
  'quality',
  'security'
]

/**
 * Format review result for display
 */
export function formatReviewResult(review: ReviewResult): string {
  const lines: string[] = []

  const statusEmoji = review.passed ? '✅' : '❌'
  lines.push(`${statusEmoji} Review ${review.passed ? 'Passed' : 'Failed'}`)
  lines.push('')
  lines.push(`Summary: ${review.summary}`)

  if (review.issues.length > 0) {
    lines.push('')
    lines.push('Issues:')

    const severityEmoji: Record<ReviewSeverity, string> = {
      info: 'ℹ️',
      warning: '⚠️',
      error: '❌',
      critical: '🚨'
    }

    for (const issue of review.issues) {
      const emoji = severityEmoji[issue.severity]
      lines.push(`  ${emoji} [${issue.severity.toUpperCase()}] ${issue.message}`)
      if (issue.suggestion) {
        lines.push(`     → Suggestion: ${issue.suggestion}`)
      }
      if (issue.location) {
        lines.push(`     → Location: ${issue.location}`)
      }
    }
  }

  return lines.join('\n')
}

/**
 * ReviewManager class for tracking reviews during execution
 */
export class ReviewManager {
  private config: ReviewConfig
  private currentReview?: ReviewResult
  private reviewHistory: ReviewResult[] = []

  constructor(config: ReviewConfig) {
    this.config = {
      categories: DEFAULT_REVIEW_CATEGORIES,
      ...config
    }
  }

  /**
   * Check if review is enabled
   */
  isEnabled(): boolean {
    return this.config.enabled
  }

  /**
   * Check if auto-review is enabled
   */
  isAutoReviewEnabled(): boolean {
    return this.config.autoReview ?? false
  }

  /**
   * Check if approval is required after review
   */
  requiresApproval(): boolean {
    return this.config.requireApproval ?? false
  }

  /**
   * Get review categories
   */
  getCategories(): string[] {
    return this.config.categories || DEFAULT_REVIEW_CATEGORIES
  }

  /**
   * Get current review result
   */
  getCurrentReview(): ReviewResult | undefined {
    return this.currentReview
  }

  /**
   * Get review history
   */
  getHistory(): ReviewResult[] {
    return this.reviewHistory
  }

  /**
   * Submit a review result
   */
  submitReview(result: Omit<ReviewResult, 'reviewedAt'>): ReviewResult {
    const review: ReviewResult = {
      ...result,
      reviewedAt: Date.now()
    }

    this.currentReview = review
    this.reviewHistory.push(review)

    return review
  }

  /**
   * Check if the last review passed
   */
  lastReviewPassed(): boolean {
    return this.currentReview?.passed ?? true
  }

  /**
   * Clear current review
   */
  clearCurrentReview(): void {
    this.currentReview = undefined
  }
}

/**
 * Create the __review__ tool
 */
export function createReviewTool(manager: ReviewManager): Tool {
  const categories = manager.getCategories()

  return {
    name: '__review__',
    description: `Review your work to ensure quality before completing.

Use this tool to:
- Check your work for completeness and correctness
- Identify potential issues, bugs, or improvements
- Ensure security best practices are followed
- Validate that all requirements are met

Review Categories: ${categories.join(', ')}

Actions:
- "submit": Submit a review with findings
- "check": Check if review is required
- "status": Get current review status

Examples:
- Submit passing review:
  { "action": "submit", "passed": true, "summary": "All requirements met", "issues": [] }

- Submit review with issues:
  { "action": "submit", "passed": false, "summary": "Found 2 issues", "issues": [
    { "severity": "error", "message": "Missing input validation", "suggestion": "Add validation for user input" },
    { "severity": "warning", "message": "No error handling", "location": "api/handler.ts:25" }
  ]}

- Check status:
  { "action": "status" }

Severity levels:
- info: Informational, no action required
- warning: Should be addressed but not blocking
- error: Must be fixed before completing
- critical: Severe issue requiring immediate attention`,

    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['submit', 'check', 'status'],
          description: 'The action to perform'
        },
        passed: {
          type: 'string',
          description: 'Whether the review passed (for "submit" action)'
        },
        summary: {
          type: 'string',
          description: 'Brief summary of the review (for "submit" action)'
        },
        issues: {
          type: 'string',
          description: 'Array of issues found (for "submit" action)'
        }
      },
      required: ['action']
    },

    execute: async (params) => {
      const { action, passed, summary, issues } = params as {
        action: string
        passed?: boolean
        summary?: string
        issues?: ReviewIssue[]
      }

      switch (action) {
        case 'submit': {
          if (typeof passed !== 'boolean') {
            return { success: false, error: '"passed" is required for submit action' }
          }
          if (!summary) {
            return { success: false, error: '"summary" is required for submit action' }
          }

          const review = manager.submitReview({
            passed,
            summary,
            issues: issues || []
          })

          return {
            success: true,
            data: {
              message: formatReviewResult(review),
              review,
              requiresApproval: manager.requiresApproval() && !passed
            }
          }
        }

        case 'check': {
          return {
            success: true,
            data: {
              enabled: manager.isEnabled(),
              autoReview: manager.isAutoReviewEnabled(),
              requiresApproval: manager.requiresApproval(),
              categories: manager.getCategories(),
              hasCurrentReview: !!manager.getCurrentReview()
            }
          }
        }

        case 'status': {
          const current = manager.getCurrentReview()
          const history = manager.getHistory()

          return {
            success: true,
            data: {
              currentReview: current,
              message: current ? formatReviewResult(current) : 'No review submitted yet',
              totalReviews: history.length,
              passedCount: history.filter(r => r.passed).length
            }
          }
        }

        default:
          return { success: false, error: `Unknown action: ${action}` }
      }
    }
  }
}

/**
 * Build review instructions for system prompt
 */
export function buildReviewInstructions(config: ReviewConfig): string {
  if (!config.enabled) return ''

  const categories = config.categories || DEFAULT_REVIEW_CATEGORIES
  const lines: string[] = [
    '',
    '## Review Requirements',
    '',
    'Before completing a task, you should review your work for quality.',
    `Review categories: ${categories.join(', ')}`,
    ''
  ]

  if (config.autoReview) {
    lines.push('You MUST perform a self-review before completing any significant task.')
  }

  if (config.requireApproval) {
    lines.push('If your review finds errors or critical issues, you must fix them before completing.')
  }

  lines.push('')
  lines.push('Use the __review__ tool to submit your review findings.')

  return lines.join('\n')
}
