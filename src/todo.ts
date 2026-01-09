/**
 * Todo List Management
 *
 * Provides todo list functionality for agents to track and execute tasks.
 */

import type { Tool, TodoItem, TodoStatus, TodoList } from "./types.js";

/**
 * Generate unique ID for todo items
 */
function generateId(): string {
  return Math.random().toString(36).substring(2, 9);
}

/**
 * Format todo list for display
 */
export function formatTodoList(todos: TodoItem[]): string {
  if (todos.length === 0) {
    return "No tasks in the todo list.";
  }

  const statusEmoji: Record<TodoStatus, string> = {
    pending: "⬜",
    in_progress: "🔄",
    completed: "✅",
  };

  return todos
    .map((todo, index) => {
      const emoji = statusEmoji[todo.status];
      // Show activeForm when in_progress, otherwise show content
      const label =
        todo.status === "in_progress" && todo.activeForm
          ? todo.activeForm
          : todo.content;
      return `${index + 1}. ${emoji} ${label}`;
    })
    .join("\n");
}

/**
 * Create the TodoManager class for tracking todos during execution
 */
export class TodoManager {
  private items: Map<string, TodoItem> = new Map();
  private currentTaskId?: string;

  /**
   * Get all todo items
   */
  getAll(): TodoItem[] {
    return Array.from(this.items.values());
  }

  /**
   * Get current task being worked on
   */
  getCurrentTask(): TodoItem | undefined {
    if (!this.currentTaskId) return undefined;
    return this.items.get(this.currentTaskId);
  }

  /**
   * Add a new todo item
   */
  add(content: string, activeForm?: string): TodoItem {
    const item: TodoItem = {
      id: generateId(),
      content,
      activeForm,
      status: "pending",
      createdAt: Date.now(),
    };
    this.items.set(item.id, item);
    return item;
  }

  /**
   * Set multiple todos at once (replaces existing)
   */
  setAll(
    todos: Array<{ content: string; activeForm?: string; status?: TodoStatus }>
  ): TodoItem[] {
    this.items.clear();
    this.currentTaskId = undefined;

    const items = todos.map((todo) => {
      const item: TodoItem = {
        id: generateId(),
        content: todo.content,
        activeForm: todo.activeForm,
        status: todo.status || "pending",
        createdAt: Date.now(),
      };
      this.items.set(item.id, item);
      return item;
    });

    // Set first pending as in_progress
    const firstPending = items.find((i) => i.status === "pending");
    if (firstPending) {
      firstPending.status = "in_progress";
      this.currentTaskId = firstPending.id;
    }

    return items;
  }

  /**
   * Mark a todo as in progress
   */
  startTask(id: string): TodoItem | undefined {
    const item = this.items.get(id);
    if (!item) return undefined;

    // Mark previous current as pending if not completed
    if (this.currentTaskId && this.currentTaskId !== id) {
      const current = this.items.get(this.currentTaskId);
      if (current && current.status === "in_progress") {
        current.status = "pending";
      }
    }

    item.status = "in_progress";
    this.currentTaskId = id;
    return item;
  }

  /**
   * Mark a todo as completed and start next
   */
  completeTask(
    id: string
  ): { completed: TodoItem; next?: TodoItem } | undefined {
    const item = this.items.get(id);
    if (!item) return undefined;

    item.status = "completed";
    item.completedAt = Date.now();

    if (this.currentTaskId === id) {
      this.currentTaskId = undefined;
    }

    // Find and start next pending task
    const nextPending = Array.from(this.items.values()).find(
      (i) => i.status === "pending"
    );
    if (nextPending) {
      nextPending.status = "in_progress";
      this.currentTaskId = nextPending.id;
      return { completed: item, next: nextPending };
    }

    return { completed: item };
  }

  /**
   * Complete current task and move to next
   */
  completeCurrentAndNext(): { completed?: TodoItem; next?: TodoItem } {
    if (!this.currentTaskId) {
      // No current task, find first pending
      const pending = Array.from(this.items.values()).find(
        (i) => i.status === "pending"
      );
      if (pending) {
        pending.status = "in_progress";
        this.currentTaskId = pending.id;
        return { next: pending };
      }
      return {};
    }

    return this.completeTask(this.currentTaskId) || {};
  }

  /**
   * Check if all tasks are completed
   */
  isAllCompleted(): boolean {
    return Array.from(this.items.values()).every(
      (i) => i.status === "completed"
    );
  }

  /**
   * Get progress stats
   */
  getProgress(): {
    total: number;
    completed: number;
    pending: number;
    inProgress: number;
  } {
    const items = Array.from(this.items.values());
    return {
      total: items.length,
      completed: items.filter((i) => i.status === "completed").length,
      pending: items.filter((i) => i.status === "pending").length,
      inProgress: items.filter((i) => i.status === "in_progress").length,
    };
  }
}

/**
 * Create the __todo__ tool
 */
export function createTodoTool(manager: TodoManager): Tool {
  return {
    name: "__todo__",
    description: `Use this tool to create and manage a structured task list for your current work session. This helps you track progress, organize complex tasks, and demonstrate thoroughness to the user.
It also helps the user understand the progress of the task and overall progress of their requests.

## When to Use This Tool
Use this tool proactively in these scenarios:

1. Complex multi-step tasks - When a task requires 3 or more distinct steps or actions
2. Non-trivial and complex tasks - Tasks that require careful planning or multiple operations
3. User explicitly requests todo list - When the user directly asks you to use the todo list
4. User provides multiple tasks - When users provide a list of things to be done (numbered or comma-separated)
5. After receiving new instructions - Immediately capture user requirements as todos
6. When you start working on a task - Mark it as in_progress BEFORE beginning work. Ideally you should only have one todo as in_progress at a time
7. After completing a task - Mark it as completed and add any new follow-up tasks discovered during execution
8. NEVER add tasks about calling agent tools.

## When NOT to Use This Tool

Skip using this tool when:
1. There is only a single, straightforward task
2. The task is trivial and tracking it provides no organizational benefit
3. The task can be completed in less than 3 trivial steps
4. The task is purely conversational or informational

NOTE that you should not use this tool if there is only one trivial task to do. In this case you are better off just doing the task directly.

## Examples of When to Use the Todo List

<example>
User: I need to plan a three-day trip to Paris. Include hotel bookings, restaurant reservations, and museum visits.
Assistant: I'll help you plan your Paris trip. Let me create a todo list to organize all the components.
*Creates todo list with the following items:*
1. Researching and recommending hotels in central Paris
2. Creating day-by-day itinerary with museum visits
3. Suggesting restaurants for each meal with reservation details
4. Adding transportation options between locations
5. Compiling final trip document with all bookings and confirmations
*Begins working on the first task*

<reasoning>
The assistant used the todo list because:
1. Trip planning is a multi-step process requiring research across multiple categories
2. The user specified several distinct components (hotels, restaurants, museums)
3. This is a complex task that benefits from systematic tracking
4. The checklist ensures nothing is overlooked in the planning process
</reasoning>
</example>

<example>
User: Help me organize my research paper on climate change. I need to restructure the sections, add citations, and create a bibliography.
Assistant: Let me first review your current paper structure to understand what needs to be reorganized.
*Reviews the document and identifies organizational issues*
Assistant: I've reviewed your paper and identified several areas that need attention. Let me create a todo list to track these improvements.
*Creates todo list with specific items for each section that needs restructuring, citation additions, and bibliography formatting*

<reasoning>
The assistant used the todo list because:
1. First, the assistant reviewed the document to understand its scope
2. Upon analysis, it identified this requires multiple distinct operations
3. The todo list helps ensure each section is properly addressed
4. This systematic approach maintains consistency throughout the document
</reasoning>
</example>

<example>
User: I want to redecorate my living room: new paint color, furniture arrangement, lighting fixtures, and window treatments.
Assistant: I'll help you redecorate your living room. Let's organize these elements into a structured plan.
*Creates a todo list breaking down each aspect into specific tasks with design considerations*
Assistant: Let's start with selecting a paint color scheme. I'll need to consider your existing furniture, natural lighting, and the mood you want to create.

<reasoning>
The assistant used the todo list because:
1. The user provided multiple distinct elements in a comma-separated list
2. Interior design involves multiple coordinated decisions
3. The todo list helps organize these interconnected design choices
4. This approach ensures all elements work together cohesively
</reasoning>
</example>

<example>
User: My garden needs work. It looks messy and the plants aren't thriving.
Assistant: I'll help improve your garden. First, let me understand the current state and identify the main issues.
*Asks questions about garden size, current plants, sunlight, and soil conditions*
Assistant: Based on your description, I've identified several improvements needed. Let me create a todo list to systematically address each issue.
*Creates todo list with items like: 1) Removing overgrown weeds and dead plants, 2) Testing and amending soil pH and nutrients, 3) Reorganizing plant layout for better sunlight exposure, 4) Adding mulch for moisture retention, 5) Creating a watering schedule*
Let's begin by clearing out the overgrown areas and removing plants that aren't thriving.

<reasoning>
The assistant used the todo list because:
1. First, the assistant gathered information about the garden's condition
2. Based on this assessment, it identified multiple improvement areas
3. Garden renovation is a non-trivial task requiring sequential steps
4. The todo list ensures each aspect is methodically addressed
5. This organized approach leads to better overall results
</reasoning>
</example>

## Examples of When NOT to Use the Todo List

<example>
User: What's a good recipe for chocolate chip cookies?
Assistant: Here's a classic chocolate chip cookie recipe:

**Ingredients:**
- 2¼ cups all-purpose flour
- 1 tsp baking soda
- 1 cup butter, softened
- ¾ cup sugar
- ¾ cup brown sugar
- 2 eggs
- 2 tsp vanilla extract
- 2 cups chocolate chips

**Instructions:**
Mix dry ingredients, cream butter and sugars, add eggs and vanilla, combine with dry mixture, fold in chocolate chips. Bake at 375°F for 9-11 minutes.

<reasoning>
The assistant did not use the todo list because this is a straightforward informational request. The user is asking for a recipe, not requesting help to actually bake cookies through multiple steps. There's no task execution required.
</reasoning>
</example>

<example>
User: How long does it take to fly from New York to London?
Assistant: A direct flight from New York to London typically takes about 7-8 hours. The exact duration depends on factors like wind patterns, the specific departure and arrival airports, and the flight path taken. Flights going eastbound are usually slightly shorter due to prevailing jet stream winds.

<reasoning>
The assistant did not use the todo list because this is a simple informational query with no actionable tasks. The user wants information, not assistance with booking or planning that would require multiple steps.
</reasoning>
</example>

<example>
User: Translate "Good morning" to Spanish for me.
Assistant: "Good morning" in Spanish is "Buenos días."

<reasoning>
The assistant did not use the todo list because this is a single, trivial task with an immediate answer. There are no multiple steps to organize or track, making the todo list unnecessary.
</reasoning>
</example>

## Task States and Management

1. **Task States**: Use these states to track progress:
   - pending: Task not yet started
   - in_progress: Currently working on (limit to ONE task at a time)
   - completed: Task finished successfully

   **IMPORTANT**: Task descriptions must have two forms:
   - content: The imperative form describing what needs to be done (e.g., "Research hotels", "Create itinerary")
   - activeForm: The present continuous form shown during execution (e.g., "Researching hotels", "Creating itinerary")

2. **Task Management**:
   - Update task status in real-time as you work
   - Mark tasks complete IMMEDIATELY after finishing (don't batch completions)
   - Exactly ONE task must be in_progress at any time (not less, not more)
   - Complete current tasks before starting new ones
   - Remove tasks that are no longer relevant from the list entirely

3. **Task Completion Requirements**:
   - ONLY mark a task as completed when you have FULLY accomplished it
   - If you encounter obstacles, limitations, or cannot finish, keep the task as in_progress
   - When blocked, create a new task describing what needs to be resolved
   - Never mark a task as completed if:
     - Requirements are not fully met
     - Implementation is partial
     - You encountered unresolved issues
     - You couldn't obtain necessary information or resources

4. **Task Breakdown**:
   - Create specific, actionable items
   - Break complex tasks into smaller, manageable steps
   - Use clear, descriptive task names
   - Always provide both forms:
     - content: "Research restaurant options"
     - activeForm: "Researching restaurant options"

When in doubt, use this tool. Being proactive with task management demonstrates attentiveness and ensures you complete all requirements successfully.
    `,

    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["set", "complete", "list"],
          description: "The action to perform",
        },
        items: {
          type: "string",
          description: 'Array of task descriptions (for "set" action)',
        },
      },
      required: ["action"],
    },

    execute: async (params) => {
      const { action, items: rawItems } = params as {
        action: string;
        items?: unknown;
      };

      // Parse items - could be JSON string, array of strings, or array of objects
      type TodoInput = { content: string; activeForm?: string };
      let items: TodoInput[] | undefined;

      if (rawItems) {
        let parsed: unknown = rawItems;

        // Parse JSON string if needed
        if (typeof rawItems === "string") {
          try {
            parsed = JSON.parse(rawItems);
          } catch {
            // Single string item
            parsed = [rawItems];
          }
        }

        // Convert to TodoInput array
        if (Array.isArray(parsed)) {
          items = parsed.map((item) => {
            if (typeof item === "string") {
              return { content: item };
            }
            if (
              typeof item === "object" &&
              item !== null &&
              "content" in item
            ) {
              return {
                content: (item as { content: string }).content,
                activeForm: (item as { activeForm?: string }).activeForm,
              };
            }
            return { content: String(item) };
          });
        }
      }

      switch (action) {
        case "set": {
          if (!items || items.length === 0) {
            return {
              success: false,
              error: 'Items array is required for "set" action',
            };
          }

          const todos = manager.setAll(items);
          const current = manager.getCurrentTask();
          const currentLabel = current?.activeForm || current?.content;

          return {
            success: true,
            data: {
              message: `Created ${todos.length} tasks. Starting: "${currentLabel}"`,
              todos: manager.getAll(),
              current: currentLabel,
            },
          };
        }

        case "complete": {
          const { completed, next } = manager.completeCurrentAndNext();

          if (!completed && !next) {
            return {
              success: true,
              data: {
                message: "No tasks to complete.",
                todos: manager.getAll(),
              },
            };
          }

          const progress = manager.getProgress();
          let message = "";

          if (completed) {
            message = `Completed: "${completed.content}". `;
          }
          if (next) {
            const nextLabel = next.activeForm || next.content;
            message += `Next: "${nextLabel}". `;
          } else if (manager.isAllCompleted()) {
            message += "All tasks completed!";
          }
          message += `Progress: ${progress.completed}/${progress.total}`;

          const nextLabel = next ? next.activeForm || next.content : undefined;

          return {
            success: true,
            data: {
              message,
              todos: manager.getAll(),
              current: nextLabel,
              progress,
            },
          };
        }

        case "list": {
          const todos = manager.getAll();
          const current = manager.getCurrentTask();
          const progress = manager.getProgress();
          const currentLabel = current
            ? current.activeForm || current.content
            : undefined;

          return {
            success: true,
            data: {
              message: formatTodoList(todos),
              todos,
              current: currentLabel,
              progress,
            },
          };
        }

        default:
          return { success: false, error: `Unknown action: ${action}` };
      }
    },
  };
}
