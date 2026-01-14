/**
 * Eating Consultant - Demo Terminal App
 *
 * An AI-powered nutrition assistant using OpenFoodFacts API.
 * Demonstrates sub-agent architecture with a Nutrition Counter agent.
 */

import 'dotenv/config'
import * as readline from 'readline'
import { Hive, ClaudeProvider, ConsoleLogger, ConsoleTraceProvider, Context, RunRecorder, MainAgentBuilder, SubAgentBuilder, type Message, type SubAgentConfig, type ProgressUpdate, type PendingQuestion, type EnhancedQuestion, type QuestionOption } from '@alexnetrebskii/hive-agent'
import { nutritionCounterTools, mainAgentTools, searchFoodTool, logMealTool } from './tools.js'

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

// Display pending question preview (actual collection happens in handleMultiQuestion)
function displayPendingQuestion(pq: PendingQuestion): void {
  console.log(`\nAssistant has ${pq.questions?.length || 1} question(s) for you:`)
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

// Define output schema for nutrition counter (used by both builder and config)
const nutritionOutputSchema = {
  type: 'object' as const,
  properties: {
    logged: { type: 'boolean', description: 'Whether the food was successfully logged' },
    food: { type: 'string', description: 'Name of the food that was logged' },
    calories: { type: 'number', description: 'Total calories for the portion' },
    protein: { type: 'number', description: 'Protein in grams' },
    carbs: { type: 'number', description: 'Carbs in grams' },
    fat: { type: 'number', description: 'Fat in grams' }
  },
  required: ['logged', 'food', 'calories'] as string[]
}

// Build nutrition counter prompt using SubAgentBuilder (type-safe)
const nutritionCounterPrompt = new SubAgentBuilder()
  .role('a Nutrition Counter assistant')
  .task('Log food the user ate.')
  .tools(nutritionCounterTools)  // Auto-documents available tools
  .addContextPath('meals/today.json', 'Today\'s nutrition totals and logged meals')
  .addQuestionStep('Check for Missing Information', {
    condition: 'If portionGrams is missing or 0',
    question: 'What was the portion size?',
    options: ['Small (150g)', 'Medium (250g)', 'Large (350g)']
  })
  .addQuestionStep('Ask for Meal Type', {
    condition: 'If meal type is missing',
    question: 'Which meal was this?',
    options: ['Breakfast', 'Lunch', 'Dinner', 'Snack']
  })
  .addToolsStep('Search and Log', [
    { tool: searchFoodTool, purpose: 'find nutrition data' },
    { tool: logMealTool, purpose: 'log with nutrition per 100g scaled to portion' }
  ])
  .outputSchema(nutritionOutputSchema)  // Uses same schema as config
  .build()

// Nutrition Counter sub-agent - specialized in food lookup and tracking
const nutritionCounterAgent: SubAgentConfig = {
  name: 'nutrition_counter',
  description: 'Specialized agent for logging food the user ate.',
  systemPrompt: nutritionCounterPrompt,

  inputSchema: {
    type: 'object',
    properties: {
      food: {
        type: 'string',
        description: 'Food item to log (e.g., "pasta", "chicken breast", "apple")'
      },
      portionGrams: {
        type: 'number',
        description: 'Portion size in grams (agent will ask if not provided)'
      },
      meal: {
        type: 'string',
        description: 'Meal type: breakfast, lunch, dinner, or snack (agent will ask if not provided)'
      }
    },
    required: ['food']
  },

  outputSchema: nutritionOutputSchema,  // Reuses same schema

  tools: nutritionCounterTools
}

// Define output schema for greeter
const greeterOutputSchema = {
  type: 'object' as const,
  properties: {
    greeting: { type: 'string', description: 'The greeting message to display' }
  },
  required: ['greeting'] as string[]
}

// Build greeter prompt using SubAgentBuilder
const greeterPrompt = new SubAgentBuilder()
  .role('a friendly greeter for a nutrition consultant app')
  .task('Generate a warm, welcoming greeting for the user.')
  .addContextPath('user/preferences.json', 'User preferences including name and language')
  .addGuidelines([
    'Be friendly and encouraging',
    'Mention you can help with: logging meals, viewing nutrition progress, and meal planning',
    'Keep it brief (2-3 sentences)',
    'Use the language specified (Russian or English)',
    'Adapt tone to time of day if provided'
  ])
  .outputSchema(greeterOutputSchema)
  .build()

// Greeter sub-agent - handles initial greetings and welcomes
const greeterAgent: SubAgentConfig = {
  name: 'greeter',
  description: 'Greet the user with a friendly welcome message',
  systemPrompt: greeterPrompt,

  inputSchema: {
    type: 'object',
    properties: {
      userName: { type: 'string', description: 'User name if known (optional)' },
      language: { type: 'string', description: 'Preferred language: "ru" for Russian, "en" for English' },
      timeOfDay: { type: 'string', description: 'Time of day: morning, afternoon, evening' }
    },
    required: []
  },

  outputSchema: greeterOutputSchema,

  tools: []
}

// Define output schema for meal planner
const mealPlannerOutputSchema = {
  type: 'object' as const,
  properties: {
    plan: { type: 'object', description: 'The meal plan object with title, goal, dailyCalories, and days array' },
    summary: { type: 'string', description: 'Brief summary of the plan' }
  },
  required: ['plan', 'summary'] as string[]
}

// Build meal planner prompt using SubAgentBuilder
const mealPlannerPrompt = new SubAgentBuilder()
  .role('a meal planning specialist')
  .task('Gather requirements and create a detailed meal plan.')
  .addContextPath('user/preferences.json', 'User preferences with goal and restrictions')
  .addContextPath('meals/today.json', 'Today\'s nutrition totals')
  // Enable todo tracking - AI creates own plan
  .useTodoTracking({
    exampleSteps: [
      'Reading user preferences from context',
      'Asking user about calorie target',
      'Creating 5-day meal plan for weight loss',
      'Saving plan to context'
    ]
  })
  // Questions to ask if info is missing
  .addQuestionStep('Gather Goal', {
    condition: 'If goal is not in context and not provided',
    question: "What's your goal?",
    options: ['Weight loss', 'Muscle gain', 'Maintain weight', 'Eat healthier']
  })
  .addQuestionStep('Gather Daily Calories', {
    condition: 'If daily calories is not provided',
    question: "What's your daily calorie target?",
    options: ['1500 kcal', '1800 kcal', '2000 kcal', '2500 kcal']
  })
  .addQuestionStep('Gather Days', {
    condition: 'If days is not provided',
    question: 'How many days should I plan?',
    options: ['3 days', '5 days', '7 days']
  })
  // Guidelines for plan creation
  .addGuidelines([
    'Stay within ±100 calories of the daily target',
    'Include variety across days',
    'Balance macros appropriately for the goal'
  ])
  // Things to avoid
  .constraints([
    'Never suggest foods that conflict with dietary restrictions',
    'Do not repeat the same meal on consecutive days',
    'Avoid unrealistic portion sizes'
  ])
  // Example of expected output
  .addExample(
    'User wants 1800 kcal/day for weight loss, 3 days',
    '{ plan: { title: "3-Day Weight Loss Plan", dailyCalories: 1800, days: [...] }, summary: "Created 3-day plan..." }',
    'Each day totals ~1800 kcal with balanced macros'
  )
  .addSection('Plan Format', `Create a plan object:
{
  "title": "Plan name",
  "goal": "User's goal",
  "dailyCalories": number,
  "days": [{ "day": "Monday", "meals": { breakfast, lunch, dinner, snacks }, "totalCalories": N }]
}`)
  .outputSchema(mealPlannerOutputSchema)
  .build()

// Planner sub-agent - creates meal plans
const plannerAgent: SubAgentConfig = {
  name: 'meal_planner',
  description: 'Create detailed meal plans based on user goals and preferences',
  systemPrompt: mealPlannerPrompt,

  inputSchema: {
    type: 'object',
    properties: {
      goal: { type: 'string', description: 'User goal: weight_loss, muscle_gain, maintenance, healthy (agent will ask if not provided)' },
      dailyCalories: { type: 'number', description: 'Target daily calories (agent will ask if not provided)' },
      restrictions: { type: 'array', description: 'Dietary restrictions: vegetarian, vegan, gluten-free, dairy-free, etc.' },
      days: { type: 'number', description: 'Number of days to plan, 1-7 (agent will ask if not provided)' },
      language: { type: 'string', description: 'Language for the plan: "ru" for Russian, "en" for English' }
    },
    required: []
  },

  outputSchema: mealPlannerOutputSchema,

  tools: []
}

// All sub-agents for the main agent
const subAgents = [greeterAgent, nutritionCounterAgent, plannerAgent]

// Build main agent prompt using MainAgentBuilder
// Uses .tools() and .agents() to extract descriptions from actual objects
const SYSTEM_PROMPT = new MainAgentBuilder()
  .role('the orchestrator of a nutrition consultant app')
  .description('Your role is to delegate work to sub-agents and communicate with the user.')
  .agents(subAgents)
  .tools(mainAgentTools)
  .questionHandling({})
  .addContextPath('plan/current.json', 'Meal plans from meal_planner')
  .addContextPath('user/preferences.json', 'User preferences { goal, restrictions[] }')
  .addRules([
    'Delegate first, never answer domain questions yourself',
    'Always use __ask_user__ for questions, never write questions as plain text',
    'Pass all relevant context from conversation history to sub-agents',
    'Present results in a friendly, encouraging way',
    'Use Russian if user speaks Russian'
  ])
  .build()

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

  // Create the main agent with sub-agent and run recorder
  const agent = new Hive({
    systemPrompt: SYSTEM_PROMPT,
    tools: mainAgentTools,
    agents: subAgents,
    llm: llmProvider,
    logger: createProgressLogger(),
    maxIterations: 15,
    trace: new ConsoleTraceProvider({ showCosts: true }),
    agentName: 'eating_consultant',
    recorder: new RunRecorder({ outputDir: './runs' })
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

        console.log('result', JSON.stringify(result));

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
        let currentResult = result

        // Handle question/answer loop until complete or interrupted
        while (currentResult.status === 'needs_input' && currentResult.pendingQuestion) {
          displayPendingQuestion(currentResult.pendingQuestion)

          // Collect all answers and auto-continue
          const combinedAnswer = await handleMultiQuestion(rl, currentResult.pendingQuestion!.questions)
          console.log('\n✅ Answers collected, continuing...\n')

          // Auto-continue with the collected answers
          isProcessing = true
          currentController = new AbortController()
          setupEscHandler()

          const continuedResult = await agent.run(combinedAnswer, {
            history: currentResult.history,
            signal: currentController.signal,
            context
          })

          stopEscHandler()
          isProcessing = false
          currentController = null

          // Update for next iteration or final display
          currentResult = continuedResult
          finalResult = continuedResult
          history = continuedResult.history
        }

        // Show final result
        if (currentResult.status === 'complete') {
          console.log('\nAssistant:', currentResult.response)
        } else if (currentResult.status === 'interrupted') {
          console.log(`\n⚠️  Task interrupted after ${currentResult.interrupted?.iterationsCompleted} iterations`)
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
