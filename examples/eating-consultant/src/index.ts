/**
 * Eating Consultant - Demo Terminal App
 *
 * An AI-powered nutrition assistant using OpenFoodFacts API.
 * Demonstrates sub-agent architecture with a Nutrition Counter agent.
 */

import 'dotenv/config'
import * as readline from 'readline'
import { Hive, ClaudeProvider, ConsoleLogger, ConsoleTraceProvider, Context, type Message, type SubAgentConfig, type ProgressUpdate, type PendingQuestion, type EnhancedQuestion, type QuestionOption } from '@alexnetrebskii/hive-agent'
import { nutritionCounterTools, mainAgentTools } from './tools.js'

// Helper to get option label (works with both string and QuestionOption)
function getOptionLabel(opt: string | QuestionOption): string {
  return typeof opt === 'string' ? opt : opt.label
}

// Helper to get option description (only for QuestionOption)
function getOptionDescription(opt: string | QuestionOption): string | undefined {
  return typeof opt === 'object' ? opt.description : undefined
}

// Display a single enhanced question
function displayEnhancedQuestion(q: EnhancedQuestion, index: number): void {
  const header = q.header ? `[${q.header}] ` : ''
  console.log(`\n${header}${q.question}`)

  if (q.options && q.options.length > 0) {
    q.options.forEach((opt, i) => {
      const label = getOptionLabel(opt)
      const desc = getOptionDescription(opt)
      const descText = desc ? ` - ${desc}` : ''
      console.log(`  ${i + 1}. ${label}${descText}`)
    })
    console.log(`  Or type your own answer`)
  }
}

// Collect answer for a single question using readline
async function collectAnswer(
  rl: readline.Interface,
  q: EnhancedQuestion
): Promise<string> {
  return new Promise((resolve) => {
    rl.question('Your choice: ', (input) => {
      const trimmed = input.trim()

      // If options exist, try to parse as number
      if (q.options && q.options.length > 0) {
        const index = parseInt(trimmed) - 1
        if (!isNaN(index) && index >= 0 && index < q.options.length) {
          // User entered a valid option number
          resolve(getOptionLabel(q.options[index]))
          return
        }
      }

      // Not a number or no options - use as custom text
      resolve(trimmed)
    })
  })
}

// Handle multi-question flow and return combined answer
async function handleMultiQuestion(
  rl: readline.Interface,
  questions: EnhancedQuestion[]
): Promise<string> {
  const answers: Record<string, string> = {}

  for (let i = 0; i < questions.length; i++) {
    const q = questions[i]
    displayEnhancedQuestion(q, i)
    const answer = await collectAnswer(rl, q)
    const key = q.header || `q${i}`
    answers[key] = answer
  }

  return JSON.stringify(answers)
}

// Display pending question (supports both legacy and multi-question format)
function displayPendingQuestion(pq: PendingQuestion): 'legacy' | 'multi' {
  if (pq.questions && pq.questions.length > 0) {
    // Multi-question format - just show preview, actual collection happens separately
    console.log('\nAssistant has some questions for you:')
    return 'multi'
  } else if (pq.question) {
    // Legacy single question format
    console.log('\nAssistant:', pq.question)
    if (pq.options) {
      const rawOptions = pq.options
      let parsedOptions: string[] = []
      if (typeof rawOptions === 'string') {
        try {
          parsedOptions = JSON.parse(rawOptions)
        } catch {
          parsedOptions = [rawOptions]
        }
      } else if (Array.isArray(rawOptions)) {
        parsedOptions = rawOptions
      }
      if (parsedOptions.length > 0) {
        console.log('\nOptions:')
        parsedOptions.forEach((opt, i) => console.log(`  ${i + 1}. ${opt}`))
        console.log(`  Or type your own answer`)
      }
    }
    return 'legacy'
  }
  return 'legacy'
}

// Progress display helper
function showProgress(update: ProgressUpdate): void {
  const symbols: Record<ProgressUpdate['type'], string> = {
    thinking: '🤔',
    tool_start: '🔧',
    tool_end: '✅',
    sub_agent_start: '🤖',
    sub_agent_end: '✅',
    status: 'ℹ️'
  }
  const symbol = symbols[update.type] || '•'

  // Clear line and show progress
  process.stdout.write(`\r\x1b[K${symbol} ${update.message}`)

  // If it's an end event, add newline
  if (update.type === 'tool_end' || update.type === 'sub_agent_end') {
    const duration = update.details?.duration ? ` (${update.details.duration}ms)` : ''
    process.stdout.write(`${duration}\n`)
  }
}

// Create logger with progress support and tool debugging
function createProgressLogger() {
  const base = new ConsoleLogger({ level: 'warn', prefix: '[Eating]' })
  return {
    debug: base.debug.bind(base),
    info: base.info.bind(base),
    warn: base.warn.bind(base),
    error: base.error.bind(base),
    onProgress: showProgress,
    // Show tool inputs and outputs for debugging
    onToolCall: (toolName: string, params: unknown) => {
      if (toolName.startsWith('context_')) {
        console.log(`\n📥 ${toolName} input:`, JSON.stringify(params, null, 2))
      }
    },
    onToolResult: (toolName: string, result: { success: boolean; data?: unknown; error?: string }) => {
      if (toolName.startsWith('context_')) {
        const status = result.success ? '✓' : '✗'
        console.log(`📤 ${toolName} ${status}:`, JSON.stringify(result, null, 2))
      }
    }
  }
}

// Nutrition Counter sub-agent - specialized in food lookup and tracking
// Now using inputSchema and outputSchema for structured communication
const nutritionCounterAgent: SubAgentConfig = {
  name: 'nutrition_counter',
  description: `Specialized agent for logging food the user ate.`,

  // Structured input parameters - parent provides these, not free-form prompt
  inputSchema: {
    type: 'object',
    properties: {
      food: {
        type: 'string',
        description: 'Food item to log (e.g., "pasta", "chicken breast", "apple")'
      },
      portionGrams: {
        type: 'number',
        description: 'Portion size in grams'
      },
      meal: {
        type: 'string',
        description: 'Meal type: breakfast, lunch, dinner, or snack'
      }
    },
    required: ['food', 'portionGrams', 'meal']
  },

  // Structured output - what parent receives back
  outputSchema: {
    type: 'object',
    properties: {
      logged: {
        type: 'boolean',
        description: 'Whether the food was successfully logged'
      },
      food: {
        type: 'string',
        description: 'Name of the food that was logged'
      },
      calories: {
        type: 'number',
        description: 'Total calories for the portion'
      },
      protein: {
        type: 'number',
        description: 'Protein in grams'
      },
      carbs: {
        type: 'number',
        description: 'Carbs in grams'
      },
      fat: {
        type: 'number',
        description: 'Fat in grams'
      }
    },
    required: ['logged', 'food', 'calories']
  },

  systemPrompt: `You are a Nutrition Counter assistant. Your task:

1. You receive structured input with: food, portionGrams, meal
2. Search OpenFoodFacts for the food
3. Log the meal with accurate nutrition data
4. Return structured output using __output__ tool

## Workflow

1. Parse the input parameters (food, portionGrams, meal)
2. search_food(food) to find nutrition data
3. log_meal with the nutrition per 100g scaled to portion
4. Call __output__ with summary and structured data

## CRITICAL: Always use __output__ tool

When done, call __output__ with:
- summary: Brief message like "Logged 250g pasta for breakfast: 350 kcal"
- data: { logged: true, food: "...", calories: N, protein: N, carbs: N, fat: N }

If food not found, return:
- data: { logged: false, food: "...", calories: 0 }`,

  tools: nutritionCounterTools
}

const SYSTEM_PROMPT = `You are a friendly nutrition consultant powered by real food data from OpenFoodFacts.

## Capabilities

1. **Log Meals** - Use nutrition_counter agent when users mention eating something
2. **View Progress** - Show daily nutrition totals with get_daily_totals
3. **Meal Planning** - Create meal plans, use todo list to track progress
4. **Give Advice** - Provide nutrition guidance based on intake

## Context Storage

Save important data to context:

- plan/current.json - Meal plans { title, goal, dailyCalories, days[] }
- meals/today.json - Today's nutrition { totalCalories, totalProtein, totalCarbs, totalFat, meals[] }
- user/preferences.json - User preferences { goal, restrictions[] }
- notes/advice.md - Nutritional recommendations (markdown)

Always save meal plans and user preferences to context.

## Workflow

### Logging meals
When user says "I had chicken for lunch":
1. Ask for portion if unclear (150g small, 250g medium, 350g large)
2. Call nutrition_counter with { food, portionGrams, meal }
3. Summarize: "Recorded chicken - 350 kcal"

### Meal planning
When user asks for a meal plan:
1. Ask clarifying questions: goal, daily calories, restrictions
2. Create todo list to track each day
3. Write out the full plan with meals and calories
4. Save plan to context

Example plan format:
📅 **Понедельник** (~1800 ккал)
🍳 Завтрак: Овсянка с ягодами (350 ккал)
🍽️ Обед: Курица с рисом (500 ккал)
🍲 Ужин: Рыба с овощами (400 ккал)

## Rules

- Ask clarifying questions before complex tasks
- Use todo list for multi-step tasks
- Be encouraging, never judgmental
- Use Russian if user speaks Russian

Start by greeting the user!`

async function main() {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    console.error('Error: ANTHROPIC_API_KEY environment variable is required')
    console.error('Create a .env file with: ANTHROPIC_API_KEY=your-key')
    process.exit(1)
  }

  const llmProvider = new ClaudeProvider({
    apiKey,
    model: 'claude-3-haiku-20240307',
    maxTokens: 2000
  })

  // Create context for agent communication with validation
  const context = new Context({
    strict: false,  // Allow any path (set to true to restrict to defined paths only)
    paths: {
      // Meal plan with schema validation
      'plan/current.json': {
        validator: {
          type: 'object',
          properties: {
            title: { type: 'string' },
            goal: { type: 'string' },
            dailyCalories: { type: 'number' },
            days: { type: 'array' }
          },
          required: ['title', 'days']
        }
      },

      // Daily totals with initial value
      'meals/today.json': {
        validator: {
          type: 'object',
          properties: {
            totalCalories: { type: 'number' },
            totalProtein: { type: 'number' },
            totalCarbs: { type: 'number' },
            totalFat: { type: 'number' },
            meals: { type: 'array' }
          }
        },
        value: { totalCalories: 0, totalProtein: 0, totalCarbs: 0, totalFat: 0, meals: [] }
      },

      // User preferences with schema
      'user/preferences.json': {
        validator: {
          type: 'object',
          properties: {
            goal: { type: 'string', enum: ['weight_loss', 'muscle_gain', 'maintenance', 'healthy'] },
            restrictions: { type: 'array' }
          }
        }
      },

      // Notes as markdown (format validation from extension)
      'notes/advice.md': null,

      // Analysis result as text (format validation from extension)
      'analysis/summary.txt': null
    }
  })

  // Create the main agent with sub-agent
  const agent = new Hive({
    systemPrompt: SYSTEM_PROMPT,
    tools: mainAgentTools,
    agents: [nutritionCounterAgent],
    llm: llmProvider,
    logger: createProgressLogger(),
    maxIterations: 15,
    trace: new ConsoleTraceProvider({ showCosts: true }),
    agentName: 'eating_consultant'
  })

  let history: Message[] = []
  let currentController: AbortController | null = null
  let isProcessing = false

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  })

  // Setup ESC key handler for interruption during processing
  function setupEscHandler() {
    if (!process.stdin.isTTY) return

    process.stdin.setRawMode(true)
    process.stdin.resume()
    process.stdin.once('data', (key) => {
      // ESC key (27) or Ctrl+C (3)
      if (key[0] === 27) {
        if (currentController && isProcessing) {
          // Stop immediately to prevent re-registration
          isProcessing = false
          console.log('\n\n⛔ Interrupted by ESC')
          currentController.abort()
          currentController = null
          stopEscHandler()
          return
        }
      } else if (key[0] === 3) {
        console.log('\nGoodbye!\n')
        process.exit(0)
      }
      // Continue listening if still processing
      if (isProcessing) {
        setupEscHandler()
      }
    })
  }

  function stopEscHandler() {
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(false)
    }
  }

  console.log('\n' + '='.repeat(60))
  console.log('  Eating Consultant - Powered by OpenFoodFacts')
  console.log('='.repeat(60))
  console.log('\nCommands: "quit" to exit, "clear" to reset')
  console.log('Press ESC to interrupt a running task')
  console.log('')

  // Get initial greeting
  try {
    isProcessing = true
    currentController = new AbortController()
    setupEscHandler()

    const greeting = await agent.run('Start the conversation with a greeting.', {
      history,
      signal: currentController.signal,
      context
    })

    stopEscHandler()
    isProcessing = false
    currentController = null
    history = greeting.history
    console.log('\nAssistant:', greeting.response, '\n')
  } catch (error) {
    stopEscHandler()
    isProcessing = false
    currentController = null
    console.error('Error:', error)
  }

  const prompt = () => {
    rl.question('You: ', async (input) => {
      const trimmed = input.trim()

      if (!trimmed) {
        prompt()
        return
      }

      if (trimmed.toLowerCase() === 'quit') {
        console.log('\nGoodbye! Eat well!\n')
        rl.close()
        process.exit(0)
      }

      if (trimmed.toLowerCase() === 'clear') {
        history = []
        console.log('\n--- Conversation cleared ---\n')
        prompt()
        return
      }

      try {
        isProcessing = true
        currentController = new AbortController()
        setupEscHandler()

        const result = await agent.run(trimmed, {
          history,
          signal: currentController.signal,
          context
        })

        stopEscHandler()
        isProcessing = false
        currentController = null

        // Handle interrupted status
        if (result.status === 'interrupted') {
          console.log(`\n⚠️  Task interrupted after ${result.interrupted?.iterationsCompleted} iterations`)
          // Keep partial history so user can continue or start fresh
          history = result.history
          console.log('(Partial work saved. Send a new message to continue or "clear" to reset)\n')
          prompt()
          return
        }

        history = result.history

        // Variable to track the final result to display
        let finalResult = result

        if (result.status === 'needs_input' && result.pendingQuestion) {
          const questionType = displayPendingQuestion(result.pendingQuestion)

          // For multi-question format, collect all answers and auto-continue
          if (questionType === 'multi' && result.pendingQuestion.questions) {
            const combinedAnswer = await handleMultiQuestion(rl, result.pendingQuestion.questions)
            console.log('\n✅ Answers collected, continuing...\n')

            // Auto-continue with the collected answers
            isProcessing = true
            currentController = new AbortController()
            setupEscHandler()

            const continuedResult = await agent.run(combinedAnswer, {
              history: result.history,
              signal: currentController.signal,
              context
            })

            stopEscHandler()
            isProcessing = false
            currentController = null

            // Use continued result for display
            finalResult = continuedResult
            history = continuedResult.history

            if (continuedResult.status === 'complete') {
              console.log('\nAssistant:', continuedResult.response)
            } else if (continuedResult.status === 'needs_input' && continuedResult.pendingQuestion) {
              // Show follow-up questions (legacy format will be handled by next prompt)
              displayPendingQuestion(continuedResult.pendingQuestion)
            } else if (continuedResult.status === 'interrupted') {
              console.log(`\n⚠️  Task interrupted after ${continuedResult.interrupted?.iterationsCompleted} iterations`)
            }
          }
          // Legacy format - user will answer via normal prompt (no response to show)
        } else {
          console.log('\nAssistant:', result.response)
        }

        // Show todos if any (from final result)
        if (finalResult.todos && finalResult.todos.length > 0) {
          console.log('\n📋 Tasks:')
          finalResult.todos.forEach(todo => {
            const icon = todo.status === 'completed' ? '✅' :
                         todo.status === 'in_progress' ? '🔄' : '⬜'
            console.log(`  ${icon} ${todo.content}`)
          })
        }

        // Show usage from trace
        if (finalResult.trace) {
          const trace = finalResult.trace
          console.log('\n📊 Usage:')
          console.log(`  Total: ${trace.totalInputTokens} in / ${trace.totalOutputTokens} out`)
          if (trace.totalCost > 0) {
            console.log(`  Cost: $${trace.totalCost.toFixed(4)}`)
          }
          if (trace.costByModel && Object.keys(trace.costByModel).length > 0) {
            for (const modelId of Object.keys(trace.costByModel)) {
              const usage = trace.costByModel[modelId]
              console.log(`  ${modelId}: ${usage.inputTokens} in / ${usage.outputTokens} out (${usage.calls} calls)`)
            }
          }
        }

        // Check if a plan was saved to context
        const plan = context.read<{ title?: string; goal?: string; dailyCalories?: number; days?: unknown[] }>('plan/current.json')
        if (plan) {
          console.log('\n📝 Plan saved to context:')
          console.log(`  Title: ${plan.title || 'Meal Plan'}`)
          if (plan.goal) {
            console.log(`  Goal: ${plan.goal}`)
          }
          if (plan.dailyCalories) {
            console.log(`  Daily calories: ${plan.dailyCalories} kcal`)
          }
          if (plan.days && Array.isArray(plan.days)) {
            console.log(`  Days planned: ${plan.days.length}`)
          }
        }

        // Show all context entries if any exist
        const contextItems = context.list()
        if (contextItems.length > 0) {
          console.log('\n📦 Context:')
          for (const item of contextItems) {
            console.log(`  ${item.path}: ${item.preview}`)
          }
        }

        console.log('')
      } catch (error) {
        stopEscHandler()
        isProcessing = false
        currentController = null
        console.error('Error:', error instanceof Error ? error.message : error)
        console.log('')
      }

      prompt()
    })
  }

  prompt()
}

main().catch(console.error)
