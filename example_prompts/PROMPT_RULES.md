# Prompt Writing Rules

Rules and guidelines for writing effective prompts for tools, agents, and system prompts.

---

## General Principles

1. **Be explicit** - State exactly what the agent should and should not do
2. **Use examples** - Show concrete examples of correct usage
3. **Define boundaries** - Clearly state when to use and when NOT to use
4. **Avoid emojis** - For clear professional communication, avoid emojis unless user requests them
5. **Prefer absolute paths** - Always use absolute file paths, never relative
6. **Structure with headers** - Use markdown headers to organize content

---

## Formatting Rules

Formatting is critical for LLM comprehension. Well-formatted prompts are easier to parse and follow.

### Visual Hierarchy

Use headers to create clear sections:

```markdown
# Tool/Agent Name        ← H1: Only for the title
## Major Section         ← H2: Capabilities, Usage, Examples
### Sub-section          ← H3: Specific patterns, individual examples
```

### Emphasis for Critical Rules

| Purpose | Format | Example |
|---------|--------|---------|
| Mandatory action | **MUST** / **ALWAYS** | You **MUST** read the file first |
| Prohibited action | **NEVER** / **DO NOT** | **NEVER** create files without permission |
| Critical section | `### CRITICAL:` header | `### CRITICAL: READ-ONLY MODE` |
| Key terms | **bold** | Mark task as **completed** |
| Code/params | `backticks` | Use the `file_path` parameter |

### Lists

**Use bullet lists for:**
- Capabilities and features
- Prohibited actions
- Unordered options

**Use numbered lists for:**
1. Sequential steps
2. Prioritized items
3. Process workflows

### Code Blocks

Use fenced code blocks for:
- JSON examples
- Output format templates
- Multi-line commands

```markdown
\`\`\`json
{
  "question": "Which option?",
  "options": ["A", "B", "C"]
}
\`\`\`
```

### Tables

Use tables for input/output mappings and quick reference:

```markdown
| Situation | Action |
|-----------|--------|
| User greets | Respond warmly |
| Error occurs | Log and retry |
```

### Whitespace

- **Blank lines** between sections for visual separation
- **Horizontal rules** (`---`) between major sections
- **No excessive nesting** - max 3 levels of headers

### Scannable Structure

Make prompts scannable by:

1. **Front-loading key info** - Most important rules first
2. **Bold key terms** - Critical words stand out
3. **Short paragraphs** - 2-3 sentences max
4. **Bullet points** - Easier to scan than prose

**Bad:**
```
When you use this tool you should always make sure to read the file first
and never try to write without reading because the tool will fail.
```

**Good:**
```markdown
## Usage
- **MUST** read the file first before writing
- Tool will fail if file was not read
```

### Consistent Patterns

Use consistent patterns throughout:

| Pattern | Format |
|---------|--------|
| Section headers | `## Capitalized Title` |
| List items | Start with capital, no period for short items |
| Examples | Use realistic, concrete values |
| Negatives | "When NOT to Use", "Never Do" |

---

## Tool Prompts

Tool prompts describe what a tool does and how to use it. They are injected into the agent's context when the tool is available.

### Structure

```markdown
# Tool Name

One-line description of what the tool does.

## Capabilities (optional)
- Bullet list of what the tool can do

## Usage / Usage Notes
- Required and optional parameters
- Default behaviors
- Edge cases and special handling

## When to Use (optional)
Scenarios where this tool is appropriate

## When NOT to Use (optional)
Scenarios where another tool is better

## Example(s) (optional)
Concrete usage examples

## Critical Requirements (optional)
MUST/NEVER rules that are mandatory
```

### Rules

1. **Start with action verb** - "Reads a file...", "Fetches content...", "Launches a new agent..."
2. **Document parameters** - Explain what each parameter does and its constraints
3. **State defaults** - What happens when optional parameters are omitted
4. **Handle edge cases** - Empty files, errors, redirects, timeouts
5. **Define alternatives** - When should users use a different tool instead
6. **Use MUST/NEVER for critical rules** - Make mandatory behaviors stand out

### Example Patterns

**For tools with side effects:**
```markdown
## Usage
- This tool will overwrite the existing file if there is one
- You MUST use the Read tool first before editing. This tool will fail if you did not read first
```

**For tools returning results to user:**
```markdown
## Critical Requirement
After using this tool, you MUST present the results to the user. Never just say "done" without sharing the actual content.
```

**For tools with parallel execution:**
```markdown
## Usage Notes
- Launch multiple calls concurrently whenever possible to maximize performance
- Use a single message with multiple tool uses
```

---

## Agent Prompts

Agent prompts define the personality, capabilities, and constraints of sub-agents.

### Structure

```markdown
# Agent Name

One-line description of the agent's purpose.

## System Prompt
The actual prompt sent to the agent, including:
- Role definition
- Critical constraints (especially READ-ONLY if applicable)
- Strengths/capabilities
- Guidelines for behavior
- Required output format

## When to Use
Scenarios where this agent should be spawned

## Thoroughness Levels / Perspectives (optional)
Different modes of operation
```

### Rules

1. **Define role clearly** - "You are a software architect...", "You are a file search specialist..."
2. **State constraints first** - Critical constraints (like READ-ONLY) go at the top with CRITICAL header
3. **List prohibited actions explicitly** - Use bullet lists for what the agent CANNOT do
4. **Define strengths** - What is this agent particularly good at
5. **Specify output format** - How should the agent structure its response
6. **Include performance notes** - For fast agents, explicitly state speed expectations

### READ-ONLY Agent Pattern

For agents that should NOT modify files:

```markdown
### CRITICAL: READ-ONLY MODE

This is a READ-ONLY exploration task. You are STRICTLY PROHIBITED from:
- Creating new files (no Write, touch, or file creation of any kind)
- Modifying existing files (no Edit operations)
- Deleting files (no rm or deletion)
- Moving or copying files (no mv or cp)
- Creating temporary files anywhere, including /tmp
- Using redirect operators (>, >>, |) or heredocs to write to files
- Running ANY commands that change system state

Your role is EXCLUSIVELY to [search/plan/explore]. You do NOT have access to file editing tools.
```

### Required Output Pattern

For agents that need structured output:

```markdown
### Required Output

End your response with:

\`\`\`
### Section Name
List items with format:
- path/to/file.ts - [Brief reason]
\`\`\`
```

### Performance Pattern

For agents that should be fast:

```markdown
### Performance

You are meant to be a fast agent that returns output as quickly as possible. To achieve this:
- Make efficient use of the tools: be smart about how you search
- Wherever possible spawn multiple parallel tool calls
```

---

## System Prompts

System prompts handle meta-tasks like summarization, suggestions, and clarifying questions.

### Structure

```markdown
# Purpose Name

One-line description of what this prompt does.

## Prompt / System Prompt
The actual prompt text

## Detailed Instructions (optional)
Step-by-step process or rules

## Examples (optional)
Table or list of example inputs and outputs

## Never Do (optional)
Explicit anti-patterns to avoid

## Format
Expected output format
```

### Rules

1. **Define the task clearly** - What exactly should the output accomplish
2. **Provide examples** - Use tables for input/output mappings
3. **State anti-patterns** - What should NEVER be in the output
4. **Specify format strictly** - "Reply with ONLY the suggestion, no quotes or explanation"
5. **Use thinking tags** - For complex analysis, wrap thought process in tags

### Summarization Pattern

```markdown
Before providing your final summary, wrap your analysis in `<analysis>` tags to organize your thoughts.

## Required Sections

Your summary should include the following sections:
1. Section Name - What to include
2. Section Name - What to include
...
```

### Suggestion Pattern

```markdown
## The Test
Would they think "I was just about to type that"?

## Never Suggest
- [Anti-pattern 1]
- [Anti-pattern 2]

## Format
2-8 words, match the user's style. Or nothing.
Reply with ONLY the suggestion, no quotes or explanation.
```

---

## Common Patterns

### When To Use / When NOT To Use

Always include both sections for tools and agents:

```markdown
## When to Use

Use this [tool/agent] proactively in these scenarios:
1. **Scenario name** - Brief description
2. **Scenario name** - Brief description

## When NOT to Use

Skip using this [tool/agent] when:
1. Condition that makes another approach better
2. Condition that makes this unnecessary
```

### Examples Section

Use concrete, realistic examples:

```markdown
## Examples

### GOOD - Use [Tool/Agent]
- "Add user authentication" - Requires architectural decisions
- "Optimize queries" - Multiple approaches possible

### BAD - Don't use [Tool/Agent]
- "Fix the typo" - Too simple
- "What files handle X?" - Research task, not implementation
```

### Task States (for todo-like tools)

```markdown
## Task States

- **pending**: Task not yet started
- **in_progress**: Currently working on (limit to ONE at a time)
- **completed**: Task finished successfully

## Task Management Rules

1. Update status in real-time as you work
2. Mark complete IMMEDIATELY after finishing
3. Only ONE task in_progress at any time
4. Never mark as completed if errors/blockers exist
```

### Signal/Event Handling

```markdown
## Handling Signals

[Tool/Agent] may return **signals** instead of completing. When result contains a `signal` field:

### Signal: `signal_name`
Description of what this signal means.
- `signal.field1`: What it contains
- `signal.field2`: What it contains

**How to handle**: Action to take when receiving this signal.
```

---

## Checklist

Before finalizing a prompt, verify:

### Content
- [ ] Clear one-line description at top
- [ ] All capabilities documented
- [ ] All parameters explained with defaults
- [ ] When to use scenarios listed
- [ ] When NOT to use scenarios listed
- [ ] Concrete examples provided
- [ ] MUST/NEVER rules highlighted
- [ ] Output format specified (if applicable)
- [ ] Anti-patterns listed (if applicable)
- [ ] No emojis unless user-facing feature requires them

### Formatting
- [ ] H1 only for title, H2 for sections, H3 for sub-sections
- [ ] Critical rules use **MUST** / **NEVER** bold keywords
- [ ] Parameters and code use `backticks`
- [ ] Tables for mappings and quick reference
- [ ] Bullet lists for features, numbered for steps
- [ ] Blank lines between sections
- [ ] Short paragraphs (2-3 sentences max)
- [ ] Key info front-loaded in each section
- [ ] Good/Bad examples when showing anti-patterns
