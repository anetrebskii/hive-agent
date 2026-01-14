# Context - Shared Data for Agents

Context is a virtual filesystem that enables tools and sub-agents to share data. Instead of relying on text responses (which can be lost or truncated), Context provides a structured way to store and retrieve data.

---

## For AI Agents: How to Use Context

This section is written for AI agents that need to interact with the context system.

### Available Context Tools

| Tool | Purpose | When to Use |
|------|---------|-------------|
| `context_ls` | List all paths in context | **FIRST** - Discover what data exists |
| `context_read` | Read value from a path | Read data before asking user |
| `context_write` | Write value to a path | Save results for persistence |

### Critical Rule: Check Context BEFORE Asking Questions

**ALWAYS** check context before using `__ask_user__`:

```
1. context_ls {}                              → See what paths exist
2. context_read { "path": "user/prefs.json" } → Read relevant data
3. Only if info NOT found → Use __ask_user__
4. After work → context_write to save results
```

### Step-by-Step Usage

#### Step 1: List Available Data

Always start by discovering what's in context:

```json
// Call context_ls
{ }

// Or filter by prefix
{ "prefix": "user/" }
```

Response tells you:
- `items` - Existing data with path, preview, and who wrote it
- `definedPaths` - Paths the app expects you to use
- `strict` - If true, you can ONLY write to defined paths

#### Step 2: Read Relevant Paths

If `context_ls` shows relevant data, read it:

```json
// Call context_read
{ "path": "user/preferences.json" }
```

Response:
- `found: true/false` - Whether data exists
- `value` - The actual data (if found)
- `writtenBy` - Who saved this (e.g., "main_agent")
- `updatedAt` - When it was last updated

#### Step 3: Write Your Results

After completing work, save important data:

```json
// Call context_write
{
  "path": "plan/current.json",
  "value": {
    "title": "5-Day Meal Plan",
    "goal": "weight_loss",
    "days": [...]
  }
}
```

### Path Naming Conventions

Paths use forward slashes with file extensions:

| Extension | Data Type | Example |
|-----------|-----------|---------|
| `.json` | Object or Array | `meals/today.json`, `user/prefs.json` |
| `.md` | Markdown string | `notes/advice.md`, `report/summary.md` |
| `.txt` | Plain text | `logs/debug.txt` |
| `.num` | Number | `stats/total.num` |
| `.bool` | Boolean | `flags/completed.bool` |

### Common Mistakes to Avoid

#### 1. Don't stringify JSON values

```json
// WRONG - passing string instead of object
{ "path": "data.json", "value": "{\"name\": \"Alex\"}" }

// CORRECT - pass actual object
{ "path": "data.json", "value": { "name": "Alex" } }
```

#### 2. Don't ask for data that exists in context

```
// WRONG flow:
User: "Create a meal plan"
Agent: Immediately asks "What's your goal?"

// CORRECT flow:
User: "Create a meal plan"
Agent: context_ls {} → sees "user/preferences.json" exists
Agent: context_read { "path": "user/preferences.json" } → gets { goal: "weight_loss" }
Agent: Uses goal from context, doesn't ask user
```

#### 3. Don't write to wrong path type

```json
// WRONG - writing object to .md path
{ "path": "notes.md", "value": { "text": "hello" } }

// CORRECT - .md expects string
{ "path": "notes.md", "value": "# Notes\n\nHello world" }
```

### Example Workflow: Meal Planning Agent

```
1. User asks: "Create a weekly meal plan"

2. Check context first:
   context_ls {}
   → Shows: user/preferences.json, meals/today.json

3. Read user preferences:
   context_read { "path": "user/preferences.json" }
   → Returns: { goal: "weight_loss", dailyCalories: 1800, restrictions: ["vegetarian"] }

4. Check input parameters:
   → User didn't specify days, but goal and calories are in context!

5. Only ask what's truly missing:
   __ask_user__ { questions: [{ question: "How many days?", options: ["3", "5", "7"] }] }

6. Create the plan using context data + user answer

7. Save result to context:
   context_write {
     "path": "plan/current.json",
     "value": {
       "title": "7-Day Vegetarian Weight Loss Plan",
       "goal": "weight_loss",
       "dailyCalories": 1800,
       "days": [...]
     }
   }
```

### What Each Path Typically Contains

Common path patterns and their typical content:

| Path Pattern | Contains | Example Value |
|--------------|----------|---------------|
| `user/preferences.json` | User settings | `{ goal, dailyCalories, restrictions }` |
| `user/profile.json` | User info | `{ name, age, weight }` |
| `meals/today.json` | Today's log | `{ meals: [], totalCalories }` |
| `plan/current.json` | Active plan | `{ title, days: [...] }` |
| `notes/*.md` | Text notes | Markdown string |

### Handling Validation Errors

If `context_write` fails:

```json
{
  "success": false,
  "error": "Validation failed",
  "data": {
    "errors": [
      { "path": "plan/current.json.title", "message": "Missing required property" }
    ],
    "expectedSchema": { ... }
  }
}
```

Fix by including required fields and correct types.

---

## Basic Setup

```typescript
import { Hive, ClaudeProvider, Context } from '@alexnetrebskii/hive-agent'

// 1. Create context with paths
const context = new Context({
  paths: {
    'user/preferences.json': null,        // format validation only
    'meals/today.json': { value: [] },    // with initial value
    'plan/current.json': {                // with schema validation
      validator: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          days: { type: 'array' }
        },
        required: ['title', 'days']
      }
    }
  }
})

// 2. Create agent
const agent = new Hive({
  systemPrompt: SYSTEM_PROMPT,
  tools: [...],
  llm: new ClaudeProvider({ apiKey: '...' })
})

// 3. Pass context to run
const result = await agent.run('Create a meal plan', { context })

// 4. Read data written by agent
const plan = context.read('plan/current.json')
```

## System Prompt Example

The framework automatically provides `context_write`, `context_read`, `context_ls` tools. Your system prompt only needs to explain **what paths exist** and **when to save**:

```typescript
const SYSTEM_PROMPT = `You are a nutrition consultant.

## Context Storage

Save important data to context so it persists:

- user/preferences.json - User dietary preferences { goal, restrictions }
- meals/today.json - Today's meals { totalCalories, meals: [] }
- plan/current.json - Meal plan (required: title, days array)
- notes/advice.md - Nutritional advice (markdown)

Always save meal plans and user preferences to context.`
```

## Reading Data (Application Code)

```typescript
// After agent.run() completes

// Read with type hint
const plan = context.read<{ title: string; days: string[] }>('plan/current.json')

// Check if exists
if (context.has('plan/current.json')) {
  console.log('Plan created!')
}

// Get metadata
const entry = context.getEntry('meals/today.json')
console.log(entry?.writtenBy)   // 'nutrition_agent'
console.log(entry?.updatedAt)   // timestamp

// List all data
const items = context.list()
// [{ path: 'user/preferences.json', preview: '{goal, restrictions}', updatedAt: ... }]

// List by prefix (matches paths starting with prefix)
context.list('meals/')     // 'meals/today.json', 'meals/history.json'
context.list('meals')      // same as above
context.list('mea')        // also matches 'meals/*'
context.list('user/pref')  // 'user/preferences.json'
```

## Initialization Options

### Strict Mode

Only allow writes to defined paths:

```typescript
const context = new Context({
  strict: true,  // Reject writes to undefined paths
  paths: {
    'user/data.json': null,
    'output/result.json': null
  }
})

// Works
context.write('user/data.json', { name: 'Alex' })

// Fails in strict mode
context.write('random/path.json', { foo: 'bar' })
// Error: Path "random/path.json" is not defined
```

### Initial Values

Pre-populate paths with data:

```typescript
const context = new Context({
  paths: {
    // With initial value (format validation from .json extension)
    'config/settings.json': {
      value: { theme: 'dark', language: 'en' }
    },

    // With initial value AND schema validator
    'meals/today.json': {
      validator: {
        type: 'object',
        properties: {
          totalCalories: { type: 'number' },
          meals: { type: 'array' }
        }
      },
      value: { totalCalories: 0, meals: [] }
    }
  }
})

// Data is available immediately
const settings = context.read('config/settings.json')
// { theme: 'dark', language: 'en' }
```

### Format Extensions

File-like extensions provide basic type validation:

| Extension | Validates |
|-----------|-----------|
| `.json` | Object or array |
| `.md` | String |
| `.txt` | String |
| `.num` | Number |
| `.bool` | Boolean |

```typescript
const context = new Context({
  paths: {
    'data/config.json': null,    // Must be object/array
    'notes/summary.md': null,    // Must be string
    'stats/count.num': null,     // Must be number
  }
})
```

### JSON Schema Validation

```typescript
const context = new Context({
  paths: {
    'plan/current.json': {
      validator: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          goal: { type: 'string', enum: ['weight_loss', 'muscle_gain'] },
          days: { type: 'array' }
        },
        required: ['title', 'days']
      },
      description: 'Weekly meal plan'  // Shown to AI
    }
  }
})
```

### Zod Validation

```typescript
import { z } from 'zod'

const UserSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  age: z.number().positive().optional()
})

const context = new Context({
  paths: {
    'user/profile.json': { validator: UserSchema }
  }
})
```

### Custom Validators

```typescript
const context = new Context({
  paths: {
    'data/items.json': {
      validator: (value: unknown) => {
        if (!Array.isArray(value)) {
          return [{ path: 'data/items.json', message: 'Must be array' }]
        }
        if (value.length > 100) {
          return [{ path: 'data/items.json', message: 'Max 100 items' }]
        }
        return null  // Valid
      }
    }
  }
})
```

## Writing Data (Application Code)

```typescript
// Simple write
context.write('user/preferences.json', { theme: 'dark' })

// Write with author tracking
context.write('meals/today.json', { meals: [...] }, 'nutrition_agent')

// Check result for validated paths
const result = context.write('plan/current.json', { title: 'Plan' })
if (!result.success) {
  console.log('Errors:', result.errors)
  // [{ path: 'plan/current.json.days', message: 'Missing required property: days' }]
}
```

### Runtime Path Registration

```typescript
const context = new Context({ strict: true, paths: {} })

// Add paths after construction
context.registerPath('dynamic/data.json', {
  validator: { type: 'object' },
  value: {}
})
```

### Other Operations

```typescript
// Delete
context.delete('temp/scratch')

// Clear all
context.clear()

// Export/Import
const data = context.toObject()
context.fromObject(savedData)

// Count
console.log(context.size)
```

## Sub-Agent Context

Context is automatically passed to sub-agents:

```typescript
const context = new Context({
  paths: {
    'research/findings.json': null,
    'draft/article.md': null,
    'review/feedback.json': null
  }
})

// Parent agent orchestrates sub-agents
const result = await agent.run('Write an article', { context })

// Each sub-agent writes to context:
// - researcher → 'research/findings.json'
// - writer → 'draft/article.md'
// - reviewer → 'review/feedback.json'

// Access all artifacts
const research = context.read('research/findings.json')
const draft = context.read('draft/article.md')
const review = context.read('review/feedback.json')
```

## Persisting Context

Context is in-memory. To persist across sessions:

```typescript
// Save after run
const result = await agent.run(message, { context })
await db.save(userId, context.toObject())

// Restore on next session
const saved = await db.load(userId)
if (saved) {
  context.fromObject(saved)
}
```

## Type Reference

```typescript
interface ContextConfig {
  strict?: boolean  // Only allow defined paths (default: false)
  paths?: Record<string, PathConfig | JSONSchema | ValidatorFn | ZodLike | null>
}

interface PathConfig {
  validator?: JSONSchema | ValidatorFn | ZodLike | null
  value?: unknown           // Initial value
  description?: string      // Shown to AI
}

interface WriteResult {
  success: boolean
  errors?: ValidationError[]
}

interface ValidationError {
  path: string
  message: string
  expected?: string
  received?: string
}
```
