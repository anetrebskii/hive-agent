# Prompt Builder

Fluent API for building structured system prompts. Instead of writing free-form prompt strings, use builders to create consistent, well-structured prompts.

## Overview

Two builders are available:

| Builder | Purpose | Use For |
| ------- | ------- | ------- |
| `MainAgentBuilder` | Orchestrator prompts | Main agent that delegates to sub-agents |
| `SubAgentBuilder` | Specialist prompts | Sub-agents that perform specific tasks |

## Quick Start

```typescript
import { MainAgentBuilder, SubAgentBuilder } from '@alexnetrebskii/hive-agent'

// Main agent prompt
const mainPrompt = new MainAgentBuilder()
  .role('the orchestrator of a nutrition app')
  .agents(subAgents)  // Auto-extracts from SubAgentConfig[]
  .tools(mainTools)   // Auto-extracts from Tool[]
  .addRules(['Delegate first', 'Use Russian if user speaks Russian'])
  .build()

// Sub-agent prompt
const subPrompt = new SubAgentBuilder()
  .role('a nutrition counter assistant')
  .task('Log food the user ate')
  .tools(nutritionTools)
  .addContextPath('meals/today.json', 'Today\'s logged meals')
  .outputSchema(outputSchema)
  .build()
```

---

## MainAgentBuilder

For orchestrator agents that delegate work to sub-agents.

### Basic Methods

#### `.role(role: string)`

Set the agent's identity.

```typescript
.role('the orchestrator of a customer support system')
```

#### `.description(description: string)`

Add additional context about the role.

```typescript
.description('Delegate to specialists and present results to users.')
```

### Sub-Agents

#### `.agents(configs: SubAgentConfig[])`

**Recommended.** Pass your SubAgentConfig array - automatically extracts names, descriptions, and input parameters.

```typescript
const subAgents: SubAgentConfig[] = [
  { name: 'greeter', description: 'Welcome users', ... },
  { name: 'planner', description: 'Create plans', ... }
]

builder.agents(subAgents)
```

This generates:
- Sub-agent table with name, purpose, when to use
- Parameter documentation for each sub-agent

#### `.addSubAgent(name, purpose, whenToUse)`

Manually add a sub-agent definition.

```typescript
.addSubAgent('researcher', 'Search for information', 'User asks a question')
```

#### `.addSubAgents(agents: SubAgentDef[])`

Add multiple sub-agents at once.

```typescript
.addSubAgents([
  { name: 'writer', purpose: 'Write content', whenToUse: 'User needs text' },
  { name: 'editor', purpose: 'Review content', whenToUse: 'Content needs review' }
])
```

### Tools

#### `.tools(toolObjects: Tool[])`

**Recommended.** Pass your Tool array - automatically extracts names and descriptions.

```typescript
builder.tools([getDailyTotals, clearMealLog])
```

#### `.addTool(name, description)`

Manually add a tool.

```typescript
.addTool('get_weather', 'Get current weather for a location')
```

#### `.addTools(tools: ToolDef[])`

Add multiple tools at once.

```typescript
.addTools([
  { name: 'search', description: 'Search the database' },
  { name: 'save', description: 'Save to database' }
])
```

### Context Paths

#### `.addContextPath(path, description)`

Document a context path the agent can use.

```typescript
.addContextPath('user/preferences.json', 'User settings and goals')
.addContextPath('plan/current.json', 'Active meal plan')
```

#### `.addContextPaths(paths: ContextPathDef[])`

Add multiple context paths.

```typescript
.addContextPaths([
  { path: 'user/profile.json', description: 'User profile data' },
  { path: 'history/logs.json', description: 'Activity history' }
])
```

### Question Handling

#### `.questionHandling(options)`

Configure how the agent handles sub-agent questions.

```typescript
.questionHandling({
  description: 'Always check conversation history before asking user',
  exampleFlow: [
    'Sub-agent asks for goal',
    'Check if user mentioned goal earlier',
    'If found, pass to sub-agent; if not, ask user'
  ]
})
```

### Rules

#### `.addRule(rule: string)`

Add a behavioral rule.

```typescript
.addRule('Delegate first, never answer domain questions yourself')
.addRule('Use Russian if user speaks Russian')
```

#### `.addRules(rules: string[])`

Add multiple rules at once.

```typescript
.addRules([
  'Present results in a friendly way',
  'Always confirm before destructive actions',
  'Keep responses concise'
])
```

### Examples

#### `.addExample(example: TaskExample)`

Add a task example showing the expected flow.

```typescript
.addExample({
  userInput: 'I had chicken for lunch',
  action: 'Call nutrition_counter with { food: "chicken", meal: "lunch" }',
  result: 'Present logged calories to user'
})
```

#### `.addExamples(examples: TaskExample[])`

Add multiple examples.

### Custom Sections

#### `.addSection(title, content)`

Add a custom section with any content.

```typescript
.addSection('Special Instructions', `
When handling meal plans:
1. Always check dietary restrictions first
2. Suggest alternatives for restricted foods
3. Include calorie counts for each meal
`)
```

### Build

#### `.build(): string`

Generate the final prompt string.

```typescript
const prompt = builder.build()
console.log(prompt)
```

#### `.getConfig(): MainAgentPromptConfig`

Get the current configuration object.

#### `.reset(): this`

Reset the builder to initial state (for reuse).

---

## SubAgentBuilder

For specialized agents that perform specific tasks.

### Basic Methods

#### `.role(role: string)`

Set the agent's identity.

```typescript
.role('a meal planning specialist')
```

#### `.task(task: string)`

Describe what the agent should accomplish.

```typescript
.task('Create detailed meal plans based on user goals and preferences.')
```

### Tools

#### `.tools(toolObjects: Tool[])`

**Recommended.** Document available tools from actual Tool objects.

```typescript
.tools([searchFood, logMeal, getDailyTotals])
```

Generates an "Available Tools" section listing each tool with its description.

### Context Discovery

#### `.addContextPath(path, description)`

Add a context path the agent should check. Automatically enables context discovery.

```typescript
.addContextPath('user/preferences.json', 'User dietary goals and restrictions')
.addContextPath('meals/today.json', 'Today\'s logged meals')
```

#### `.useContext()`

Enable context discovery without specifying paths.

```typescript
.useContext()  // Agent will use context_ls to discover available data
```

### Workflow Steps

#### `.addQuestionStep(description, askQuestion)`

Add a step that conditionally asks the user a question.

```typescript
.addQuestionStep('Gather Goal', {
  condition: 'If goal is not in context and not provided',
  question: "What's your goal?",
  options: ['Weight loss', 'Muscle gain', 'Maintain weight']
})
```

**Important:** When you add question steps with conditions, the builder automatically adds instructions to check input parameters and context first.

#### `.addToolStep(description, toolCalls)`

Add a step that uses tools (string-based).

```typescript
.addToolStep('Search and Log', [
  'search_food - find nutrition data',
  'log_meal - log with scaled nutrition'
])
```

#### `.addToolsStep(description, toolRefs)`

**Type-safe alternative.** Add a step using actual Tool objects.

```typescript
.addToolsStep('Search and Log', [
  { tool: searchFoodTool, purpose: 'find nutrition data' },
  { tool: logMealTool, purpose: 'log with scaled nutrition' }
])
```

#### `.addStep(step: WorkflowStep)`

Add a custom workflow step.

```typescript
.addStep({
  description: 'Validate Input',
  toolCalls: ['validate_data'],
  askQuestion: {
    condition: 'If validation fails',
    question: 'Please provide valid data',
    options: ['Retry', 'Cancel']
  }
})
```

### Guidelines and Constraints

#### `.addGuidelines(guidelines: string[])`

Add positive guidance (things to do).

```typescript
.addGuidelines([
  'Stay within ±100 calories of target',
  'Include variety across days',
  'Balance macros appropriately'
])
```

#### `.addGuideline(guideline: string)`

Add a single guideline.

#### `.constraints(constraints: string[])`

Add negative constraints (things to avoid).

```typescript
.constraints([
  'Never suggest foods that conflict with restrictions',
  'Do not repeat the same meal on consecutive days',
  'Avoid unrealistic portion sizes'
])
```

#### `.addConstraint(constraint: string)`

Add a single constraint.

### Todo Tracking

#### `.useTodoTracking(options?)`

Enable the `__todo__` tool for the agent to track its own work.

```typescript
.useTodoTracking({
  exampleSteps: [
    'Reading user preferences from context',
    'Asking about calorie target',
    'Creating meal plan',
    'Saving plan to context'
  ]
})
```

The agent will create its own todos based on the task, using these as examples.

### Instructions

#### `.instructions(instructions: string[])`

Add step-by-step instructions.

```typescript
.instructions([
  'First, check context for existing data',
  'Then, validate all required parameters',
  'Finally, perform the main task'
])
```

#### `.addInstruction(instruction: string)`

Add a single instruction.

### Examples

#### `.addExample(input, output, explanation?)`

Add an input/output example.

```typescript
.addExample(
  'User wants 1800 kcal/day for weight loss, 3 days',
  '{ plan: { title: "3-Day Plan", days: [...] } }',
  'Each day totals ~1800 kcal with balanced macros'
)
```

#### `.examples(examples: SubAgentExample[])`

Add multiple examples.

### Output Schema

#### `.outputSchema(schema: JSONSchema)`

**Recommended.** Define output format using JSON Schema.

```typescript
.outputSchema({
  type: 'object',
  properties: {
    logged: { type: 'boolean', description: 'Whether food was logged' },
    food: { type: 'string', description: 'Name of logged food' },
    calories: { type: 'number', description: 'Calories in portion' }
  },
  required: ['logged', 'food', 'calories']
})
```

Generates clear output instructions for the agent.

#### `.output(format: OutputFormat)` *(deprecated)*

Use `.outputSchema()` instead.

#### `.outputWithSummary(...)` *(deprecated)*

Use `.outputSchema()` instead.

### Custom Sections

#### `.addSection(title, content)`

Add a custom section.

```typescript
.addSection('Plan Format', `
Create a plan object:
{
  "title": "Plan name",
  "days": [{ "day": "Monday", "meals": {...} }]
}
`)
```

### Build

#### `.build(): string`

Generate the final prompt string.

#### `.getConfig(): SubAgentPromptConfig`

Get the current configuration object.

#### `.reset(): this`

Reset the builder to initial state.

---

## Complete Example

### Main Agent

```typescript
import { MainAgentBuilder } from '@alexnetrebskii/hive-agent'

const mainPrompt = new MainAgentBuilder()
  .role('the orchestrator of a nutrition consultant app')
  .description('Delegate work to sub-agents and communicate with the user.')
  .agents([greeterAgent, nutritionAgent, plannerAgent])
  .tools([getDailyTotals, clearMealLog])
  .questionHandling({})
  .addContextPath('plan/current.json', 'Meal plans from planner')
  .addContextPath('user/preferences.json', 'User preferences')
  .addRules([
    'Delegate first, never answer domain questions yourself',
    'Always use __ask_user__ for questions',
    'Pass relevant context to sub-agents',
    'Use Russian if user speaks Russian'
  ])
  .build()
```

### Sub-Agent

```typescript
import { SubAgentBuilder } from '@alexnetrebskii/hive-agent'

const nutritionPrompt = new SubAgentBuilder()
  .role('a Nutrition Counter assistant')
  .task('Log food the user ate.')
  .tools([searchFood, logMeal, getDailyTotals])
  .addContextPath('meals/today.json', 'Today\'s logged meals')
  .addQuestionStep('Check Portion', {
    condition: 'If portionGrams is missing',
    question: 'What was the portion size?',
    options: ['Small (150g)', 'Medium (250g)', 'Large (350g)']
  })
  .addQuestionStep('Check Meal Type', {
    condition: 'If meal type is missing',
    question: 'Which meal was this?',
    options: ['Breakfast', 'Lunch', 'Dinner', 'Snack']
  })
  .addToolsStep('Search and Log', [
    { tool: searchFood, purpose: 'find nutrition data' },
    { tool: logMeal, purpose: 'log with scaled nutrition' }
  ])
  .outputSchema({
    type: 'object',
    properties: {
      logged: { type: 'boolean', description: 'Success status' },
      food: { type: 'string', description: 'Food name' },
      calories: { type: 'number', description: 'Total calories' }
    },
    required: ['logged', 'food', 'calories']
  })
  .build()
```

---

## Generated Prompt Structure

### MainAgentBuilder Output

```
You are {role}. {description}

## Your Role
1. **Delegate** - Call __task__ tool to spawn sub-agents
2. **Relay questions** - When sub-agent needs input, call __ask_user__ tool
3. **Present results** - After sub-agent completes, output a text message

## Available Sub-Agents
| Agent | Purpose | When to Use |
|-------|---------|-------------|
| greeter | Welcome users | ... |

## Sub-Agent Parameters
### greeter
- **userName** (optional): User's name
- **language** (optional): Preferred language

## Handling Sub-Agent Questions
When sub-agent returns status "needs_input":
1. Check conversation history first
2. Only ask if not in history

## Direct Tools
- **get_daily_totals** - Get nutrition totals

## Context Storage
- plan/current.json - Meal plans

## Rules
- Delegate first
- Use Russian if user speaks Russian
```

### SubAgentBuilder Output

```
You are {role}.

Your task: {task}

## Available Tools
- **search_food**: Search food database
- **log_meal**: Log a meal

## Context Discovery (Do This First!)
⚠️ ALWAYS check context BEFORE asking questions:
1. Use context_ls to see what data exists
2. Use context_read to read relevant paths

Check these paths:
- meals/today.json - Today's logged meals

## Before Asking Questions
⚠️ IMPORTANT: Check input parameters and context FIRST

## Step 1: Check Portion
If portionGrams is missing, use __ask_user__ to ask:
"What was the portion size?"
Options: Small (150g), Medium (250g), Large (350g)

## Step 2: Check Meal Type
...

## Guidelines
- Stay within calorie targets

## Constraints
- ❌ Never suggest restricted foods

## Output
When done, call __output__ with:
- summary: Brief description
- data: { logged, food, calories }
```

---

## Best Practices

1. **Use type-safe methods** - `.agents()`, `.tools()`, `.outputSchema()` instead of manual definitions
2. **Define context paths** - Helps agents discover and use shared data
3. **Add question conditions** - Prevents redundant questions
4. **Use constraints** - Clearly state what to avoid
5. **Provide examples** - Shows expected input/output format
6. **Keep rules focused** - 3-5 clear behavioral rules

## Type Definitions

```typescript
interface SubAgentDef {
  name: string
  purpose: string
  whenToUse: string
  inputParams?: Array<{ name: string; description: string; required: boolean }>
}

interface ToolDef {
  name: string
  description: string
}

interface ContextPathDef {
  path: string
  description: string
}

interface TaskExample {
  userInput: string
  action: string
  result: string
}

interface WorkflowStep {
  description: string
  toolCalls?: string[]
  askQuestion?: {
    condition?: string
    question: string
    options?: string[]
  }
}

interface SubAgentExample {
  input: string
  output: string
  explanation?: string
}
```
