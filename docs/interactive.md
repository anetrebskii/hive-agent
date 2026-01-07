# Interactive Questions

Agents can pause to ask clarifying questions using the built-in `__ask_user__` tool.

## How It Works

1. Agent decides it needs clarification
2. Agent calls `__ask_user__` with question and optional options
3. Agent execution pauses with `status: 'needs_input'`
4. Your app shows the question to the user
5. User responds
6. You call `agent.run()` again with the response and history

## Basic Example

```typescript
const result = await agent.run('Create a database schema')

if (result.status === 'needs_input') {
  // Show question to user
  console.log(result.pendingQuestion?.question)
  // "What type of database? (PostgreSQL, MySQL, SQLite)"

  console.log(result.pendingQuestion?.options)
  // ["PostgreSQL", "MySQL", "SQLite"]

  // Get user's answer
  const answer = await getUserInput()

  // Continue with the answer
  const continued = await agent.run(answer, {
    history: result.history
  })
}
```

## PendingQuestion Structure

The framework supports two formats: legacy single-question and multi-question sequences.

### Legacy Single Question

```typescript
interface PendingQuestion {
  question: string      // The question text
  options?: string[]    // Optional multiple choice options
}
```

### Multi-Question Format

For asking multiple related questions at once with rich options:

```typescript
interface QuestionOption {
  label: string         // Display text (1-5 words)
  description?: string  // Explanation of what this option means
}

interface EnhancedQuestion {
  question: string      // Full question text
  header?: string       // Short label for UI (max 12 chars), e.g., "Database"
  options?: (string | QuestionOption)[]  // 2-4 choices
}

interface PendingQuestion {
  // Legacy format
  question?: string
  options?: string[]

  // Multi-question format
  questions?: EnhancedQuestion[]
}
```

### AgentResult

```typescript
interface AgentResult {
  status: 'complete' | 'needs_input' | 'interrupted'
  pendingQuestion?: PendingQuestion  // Present when status is 'needs_input'
  history: Message[]    // Includes the question
  // ...
}
```

## Terminal Example

```typescript
import * as readline from 'readline'

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
})

async function chat(message: string, history: Message[] = []) {
  const result = await agent.run(message, { history })

  if (result.status === 'needs_input' && result.pendingQuestion) {
    // Show question
    console.log('\nAgent:', result.pendingQuestion.question)

    // Show options if available
    if (result.pendingQuestion.options) {
      console.log('\nOptions:')
      result.pendingQuestion.options.forEach((opt, i) => {
        console.log(`  ${i + 1}. ${opt}`)
      })
    }

    // Get answer
    const answer = await new Promise<string>(resolve => {
      rl.question('\nYour answer: ', resolve)
    })

    // Continue conversation
    return chat(answer, result.history)
  }

  return result
}

// Usage
const result = await chat('Help me set up a new project')
console.log('Final:', result.response)
```

## Web API Example

```typescript
// POST /api/chat
export async function POST(req: Request) {
  const { message, conversationId } = await req.json()

  const result = await agent.run(message, { conversationId })

  return Response.json({
    response: result.response,
    status: result.status,
    pendingQuestion: result.pendingQuestion
  })
}

// Client-side
async function sendMessage(message: string) {
  const response = await fetch('/api/chat', {
    method: 'POST',
    body: JSON.stringify({ message, conversationId })
  })

  const data = await response.json()

  if (data.status === 'needs_input') {
    // Show question UI
    showQuestionDialog(data.pendingQuestion)
  } else {
    // Show response
    showMessage(data.response)
  }
}
```

## React Component

```tsx
function Chat() {
  const [messages, setMessages] = useState<Message[]>([])
  const [pending, setPending] = useState<PendingQuestion | null>(null)

  async function send(text: string) {
    const result = await agent.run(text, { history: messages })

    if (result.status === 'needs_input') {
      setPending(result.pendingQuestion!)
      setMessages(result.history)
    } else {
      setPending(null)
      setMessages(result.history)
    }
  }

  return (
    <div>
      <MessageList messages={messages} />

      {pending ? (
        <QuestionUI
          question={pending.question}
          options={pending.options}
          onAnswer={send}
        />
      ) : (
        <Input onSend={send} />
      )}
    </div>
  )
}

function QuestionUI({ question, options, onAnswer }) {
  if (options) {
    return (
      <div>
        <p>{question}</p>
        {options.map(opt => (
          <button key={opt} onClick={() => onAnswer(opt)}>
            {opt}
          </button>
        ))}
      </div>
    )
  }

  return (
    <div>
      <p>{question}</p>
      <Input onSend={onAnswer} />
    </div>
  )
}
```

## Disabling __ask_user__

For sub-agents or automated pipelines, disable the tool:

```typescript
const automatedAgent: SubAgentConfig = {
  name: 'processor',
  description: 'Process data without user interaction',
  systemPrompt: '...',
  tools: [...]
}

// Sub-agents automatically have __ask_user__ disabled
// They should make decisions autonomously

// Or for main agent in automated contexts:
const agent = new Hive({
  systemPrompt: '...',
  tools: [...],
  llm: provider,
  disableAskUser: true
})
```

## System Prompt Guidance

Tell the agent when to ask questions:

```typescript
const SYSTEM_PROMPT = `You are a helpful assistant.

## When to Ask Questions

Use __ask_user__ when:
- The request is ambiguous
- You need to choose between multiple valid approaches
- User preferences would affect the outcome
- Critical decisions need confirmation

Do NOT ask when:
- You can make a reasonable default choice
- The question is trivial
- You've already asked about the same topic

## Question Format

Always provide options when possible:
- Good: "Which database? Options: PostgreSQL, MySQL, SQLite"
- Bad: "What database do you want?"
`
```

## Multi-Question Example

When the agent asks multiple questions at once:

```typescript
// Agent returns questions array
if (result.pendingQuestion?.questions) {
  const answers: Record<string, string> = {}

  for (const q of result.pendingQuestion.questions) {
    console.log(`\n${q.header || 'Question'}: ${q.question}`)

    if (q.options) {
      q.options.forEach((opt, i) => {
        const label = typeof opt === 'string' ? opt : opt.label
        const desc = typeof opt === 'object' ? opt.description : undefined
        console.log(`  ${i + 1}. ${label}${desc ? ` - ${desc}` : ''}`)
      })
    }

    const answer = await getUserInput()
    answers[q.header || q.question] = answer
  }

  // Continue with all answers as JSON
  const continued = await agent.run(JSON.stringify(answers), {
    history: result.history
  })
}
```

### React Multi-Question Component

```tsx
function MultiQuestionUI({ questions, onAnswer }) {
  const [answers, setAnswers] = useState<Record<string, string>>({})

  function handleOptionClick(questionIndex: number, option: string) {
    const q = questions[questionIndex]
    const key = q.header || `q${questionIndex}`
    setAnswers({ ...answers, [key]: option })
  }

  function handleSubmit() {
    onAnswer(JSON.stringify(answers))
  }

  return (
    <div className="space-y-4">
      {questions.map((q, qi) => (
        <div key={qi} className="border p-4 rounded">
          {q.header && <span className="chip">{q.header}</span>}
          <p className="font-medium">{q.question}</p>

          <div className="flex flex-wrap gap-2 mt-2">
            {q.options?.map((opt, oi) => {
              const label = typeof opt === 'string' ? opt : opt.label
              const desc = typeof opt === 'object' ? opt.description : undefined
              const key = q.header || `q${qi}`
              const selected = answers[key] === label

              return (
                <button
                  key={oi}
                  onClick={() => handleOptionClick(qi, label)}
                  className={selected ? 'selected' : ''}
                  title={desc}
                >
                  {label}
                </button>
              )
            })}
          </div>
        </div>
      ))}

      <button onClick={handleSubmit}>Submit Answers</button>
    </div>
  )
}
```

## Handling Sequential Questions

Sometimes agents need to ask several questions. Handle this with a loop:

```typescript
async function runWithQuestions(initialMessage: string) {
  let message = initialMessage
  let history: Message[] = []

  while (true) {
    const result = await agent.run(message, { history })

    if (result.status === 'needs_input') {
      // Show question, get answer
      const answer = await showQuestionAndGetAnswer(result.pendingQuestion!)
      message = answer
      history = result.history
    } else {
      // Done
      return result
    }
  }
}
```
