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
    description: `Use this tool to create and manage a structured task list for your current coding session. This helps you track progress, organize complex tasks, and demonstrate thoroughness to the user.
It also helps the user understand the progress of the task and overall progress of their requests.

## When to Use This Tool
Use this tool proactively in these scenarios:

1. Complex multi-step tasks - When a task requires 3 or more distinct steps or actions
2. Non-trivial and complex tasks - Tasks that require careful planning or multiple operations
3. User explicitly requests todo list - When the user directly asks you to use the todo list
4. User provides multiple tasks - When users provide a list of things to be done (numbered or comma-separated)
5. After receiving new instructions - Immediately capture user requirements as todos
6. When you start working on a task - Mark it as in_progress BEFORE beginning work. Ideally you should only have one todo as in_progress at a time
7. After completing a task - Mark it as completed and add any new follow-up tasks discovered during implementation

## When NOT to Use This Tool

Skip using this tool when:
1. There is only a single, straightforward task
2. The task is trivial and tracking it provides no organizational benefit
3. The task can be completed in less than 3 trivial steps
4. The task is purely conversational or informational

NOTE that you should not use this tool if there is only one trivial task to do. In this case you are better off just doing the task directly.

## Examples of When to Use the Todo List

<example>
User: I want to add a dark mode toggle to the application settings. Make sure you run the tests and build when you're done!
Assistant: I'll help add a dark mode toggle to your application settings. Let me create a todo list to track this implementation.
*Creates todo list with the following items:*
1. Creating dark mode toggle component in Settings page
2. Adding dark mode state management (context/store)
3. Implementing CSS-in-JS styles for dark theme
4. Updating existing components to support theme switching
5. Running tests and build process, addressing any failures or errors that occur
*Begins working on the first task*

<reasoning>
The assistant used the todo list because:
1. Adding dark mode is a multi-step feature requiring UI, state management, and styling changes
2. The user explicitly requested tests and build be run afterward
3. The assistant inferred that tests and build need to pass by adding "Ensure tests and build succeed" as the final task
</reasoning>
</example>

<example>
User: Help me rename the function getCwd to getCurrentWorkingDirectory across my project
Assistant: Let me first search through your codebase to find all occurrences of 'getCwd'.
*Uses grep or search tools to locate all instances of getCwd in the codebase*
Assistant: I've found 15 instances of 'getCwd' across 8 different files. Let me create a todo list to track these changes.
*Creates todo list with specific items for each file that needs updating*

<reasoning>
The assistant used the todo list because:
1. First, the assistant searched to understand the scope of the task
2. Upon finding multiple occurrences across different files, it determined this was a complex task with multiple steps
3. The todo list helps ensure every instance is tracked and updated systematically
4. This approach prevents missing any occurrences and maintains code consistency
</reasoning>
</example>


<example>
User: I need to implement these features for my e-commerce site: user registration, product catalog, shopping cart, and checkout flow.
Assistant: I'll help implement these features. First, let's add all the features to the todo list.
*Creates a todo list breaking down each feature into specific tasks based on the project architecture*
Assistant: Let's start with user registration. This will involve creating database models, API endpoints, and frontend forms that integrate with your existing authentication system.

<reasoning>
The assistant used the todo list because:
1. The user provided multiple complex features to implement in a comma separated list
2. The todo list helps organize these large features into manageable tasks
3. This approach allows for tracking progress across the entire implementation
</reasoning>
</example>

<example>
User: Can you help optimize my React application? It's rendering slowly and has performance issues.</user>
Assistant: I'll help optimize your React application. First, let me examine your codebase to identify potential performance bottlenecks.
*Reviews component structure, render patterns, state management, and data fetching*
Assistant: After analyzing your codebase, I've identified several performance issues. Let me create a todo list to track our optimization efforts.
*Creates todo list with items like: 1) Implementing memoization for expensive calculations in ProductList, 2) Adding virtualization for long lists in Dashboard, 3) Optimizing image loading in Gallery component, 4) Fixing state update loops in ShoppingCart, 5) Reviewing bundle size and implementing code splitting*
Let's start by implementing memoization for the expensive calculations in your ProductList component.</assistant>

<reasoning>
The assistant used the todo list because:
1. First, the assistant examined the codebase to identify specific performance issues
2. Based on this analysis, it identified multiple optimization opportunities
3. Performance optimization is a non-trivial task requiring multiple steps
4. The todo list helps methodically track improvements across different components
5. This systematic approach ensures all performance bottlenecks are addressed
</reasoning>
</example>

## Examples of When NOT to Use the Todo List

<example>
User: How do I print 'Hello World' in Python?
Assistant: In Python, you can print "Hello World" with this simple code:

python
print("Hello World")

This will output the text "Hello World" to the console when executed.</assistant>

<reasoning>
The assistant did not use the todo list because this is a single, trivial task that can be completed in one step. There's no need to track multiple tasks or steps for such a straightforward request.
</reasoning>
</example>

<example>
User: What does the git status command do?
Assistant: The git status command shows the current state of your working directory and staging area. It displays which changes have been staged, which haven't, and which files aren't being tracked by Git. This is a fundamental command for understanding the current state of your repository before making commits.

<reasoning>
The assistant did not use the todo list because this is an informational request with no actual coding task to complete. The user is simply asking for an explanation, not for the assistant to perform multiple steps or tasks.
</reasoning>
</example>

<example>
User: Run npm install for me and tell me what happens.
Assistant: I'll run the npm install command for you.

*Executes: npm install*

The command completed successfully. Here's the output:
[Output of npm install command]

All dependencies have been installed according to your package.json file.

<reasoning>
The assistant did not use the todo list because this is a single command execution with immediate results. There are no multiple steps to track or organize, making the todo list unnecessary for this straightforward task.
</reasoning>
</example>

## Task States and Management

1. **Task States**: Use these states to track progress:
   - pending: Task not yet started
   - in_progress: Currently working on (limit to ONE task at a time)
   - completed: Task finished successfully

   **IMPORTANT**: Task descriptions must have two forms:
   - content: The imperative form describing what needs to be done (e.g., "Run tests", "Build the project")
   - activeForm: The present continuous form shown during execution (e.g., "Running tests", "Building the project")

2. **Task Management**:
   - Update task status in real-time as you work
   - Mark tasks complete IMMEDIATELY after finishing (don't batch completions)
   - Exactly ONE task must be in_progress at any time (not less, not more)
   - Complete current tasks before starting new ones
   - Remove tasks that are no longer relevant from the list entirely

3. **Task Completion Requirements**:
   - ONLY mark a task as completed when you have FULLY accomplished it
   - If you encounter errors, blockers, or cannot finish, keep the task as in_progress
   - When blocked, create a new task describing what needs to be resolved
   - Never mark a task as completed if:
     - Tests are failing
     - Implementation is partial
     - You encountered unresolved errors
     - You couldn't find necessary files or dependencies

4. **Task Breakdown**:
   - Create specific, actionable items
   - Break complex tasks into smaller, manageable steps
   - Use clear, descriptive task names
   - Always provide both forms:
     - content: "Fix authentication bug"
     - activeForm: "Fixing authentication bug"

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
