/**
 * Eating Consultant - Demo Terminal App
 *
 * An AI-powered nutrition assistant using OpenFoodFacts API.
 * Main agent drives every workflow through skills — no sub-agents.
 */

import "dotenv/config";
import * as readline from "readline";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  Tuplet,
  OpenRouterProvider,
  FallbackProvider,
  ConsoleLogger,
  ConsoleTraceProvider,
  LangfuseTraceProvider,
  MultiTraceProvider,
  MemoryRepository,
  Workspace,
  FileWorkspaceProvider,
  RunRecorder,
  type Message,
  type SkillConfig,
  type ProgressUpdate,
  type PendingQuestion,
  type EnhancedQuestion,
  type QuestionOption,
  type TaskUpdateNotification,
  type PromptSection,
  type HistoryInjection,
  type TraceProvider,
  type OpenRouterProviderConfig,
} from "tuplet";
import { nutritionCounterTools } from "./tools.js";

/** Check if workspace mode is enabled via --workspace flag or WORKSPACE env var */
const useWorkspace =
  process.argv.includes("--workspace") || process.env.USE_WORKSPACE === "1";

/** Host-provided context passed to PromptSections and HistoryInjections */
interface EatingCtx {
  isAdmin: boolean;
  locale: "en" | "ru";
}

// Helper to get option label (works with both string and QuestionOption)
function getOptionLabel(opt: string | QuestionOption): string {
  return typeof opt === "string" ? opt : opt.label;
}

// Helper to get option description (only for QuestionOption)
function getOptionDescription(
  opt: string | QuestionOption,
): string | undefined {
  return typeof opt === "object" ? opt.description : undefined;
}

// Display a single enhanced question
function displayEnhancedQuestion(q: EnhancedQuestion): void {
  const header = q.header ? `[${q.header}] ` : "";
  console.log(`\n${header}${q.question}`);

  if (q.options && q.options.length > 0) {
    q.options.forEach((opt, i) => {
      const label = getOptionLabel(opt);
      const desc = getOptionDescription(opt);
      const descText = desc ? ` - ${desc}` : "";
      console.log(`  ${i + 1}. ${label}${descText}`);
    });
    console.log(`  Or type your own answer`);
  }
}

// Collect answer for a single question using readline
async function collectAnswer(
  rl: readline.Interface,
  q: EnhancedQuestion,
): Promise<string> {
  return new Promise((resolve) => {
    rl.question("Your choice: ", (input) => {
      const trimmed = input.trim();

      // If options exist, try to parse as number
      if (q.options && q.options.length > 0) {
        const index = parseInt(trimmed) - 1;
        if (!isNaN(index) && index >= 0 && index < q.options.length) {
          // User entered a valid option number
          resolve(getOptionLabel(q.options[index]));
          return;
        }
      }

      // Not a number or no options - use as custom text
      resolve(trimmed);
    });
  });
}

// Handle multi-question flow and return combined answer
async function handleMultiQuestion(
  rl: readline.Interface,
  questions: EnhancedQuestion[],
): Promise<string> {
  const answers: Record<string, string> = {};

  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];
    displayEnhancedQuestion(q);
    const answer = await collectAnswer(rl, q);
    const key = q.header || `q${i}`;
    answers[key] = answer;
  }

  return JSON.stringify(answers);
}

// Display pending question preview (actual collection happens in handleMultiQuestion)
function displayPendingQuestion(pq: PendingQuestion): void {
  console.log(
    `\nAssistant has ${pq.questions?.length || 1} question(s) for you:`,
  );
}

// Progress display helper
function showProgress(update: ProgressUpdate): void {
  const symbols: Record<ProgressUpdate["type"], string> = {
    thinking: "🤔",
    text: "💬",
    tool_start: "🔧",
    tool_end: "✅",
    sub_agent_start: "🤖",
    sub_agent_end: "✅",
    status: "ℹ️",
    usage: "📊",
  };
  const symbol = symbols[update.type] || "•";

  // Show usage as a compact cost line
  if (update.type === "usage") {
    const usage = update.details?.usage;
    const costStr =
      usage?.cumulativeCost != null
        ? ` | Cost: $${usage.cumulativeCost.toFixed(4)}`
        : "";
    process.stdout.write(
      `\r\x1b[K\x1b[2m${symbol} ${update.message}${costStr}\x1b[0m\n`,
    );
    return;
  }

  // Clear line and show progress (prefer label for user-friendly text)
  const displayText = update.label ?? update.message;
  process.stdout.write(`\r\x1b[K${symbol} ${displayText}`);

  // If it's an end event, add newline
  if (update.type === "tool_end" || update.type === "sub_agent_end") {
    const duration = update.details?.duration
      ? ` (${update.details.duration}ms)`
      : "";
    process.stdout.write(`${duration}\n`);
  }
}

// Task update display helper
function showTaskUpdate(update: TaskUpdateNotification): void {
  const agentLabel = update.agentName ? `[${update.agentName}]` : "[Main]";
  const actionEmoji =
    update.action === "create"
      ? "📋"
      : update.action === "delete"
        ? "🗑️"
        : "🔄";

  console.log(`\n${actionEmoji} ${agentLabel} Task ${update.action}:`);

  // Show progress
  const { completed, total, inProgress } = update.progress;
  console.log(
    `   Progress: ${completed}/${total} completed${inProgress > 0 ? `, ${inProgress} in progress` : ""}`,
  );

  // Show current task if any
  if (update.current) {
    const label = update.current.activeForm || update.current.subject;
    console.log(`   Current: ${label}`);
  }

  // Show task list
  if (update.tasks.length > 0) {
    update.tasks.forEach((task) => {
      const icon =
        task.status === "completed"
          ? "✅"
          : task.status === "in_progress"
            ? "🔄"
            : "⬜";
      const owner = task.owner ? ` [@${task.owner}]` : "";
      const blocked = task.blockedBy?.length
        ? ` (blocked by: ${task.blockedBy.join(", ")})`
        : "";
      console.log(`   ${task.id}. ${icon} ${task.subject}${owner}${blocked}`);
    });
  }
  console.log("");
}

// Create logger with progress support and tool debugging
function createProgressLogger() {
  const base = new ConsoleLogger({ level: "warn", prefix: "[Eating]" });
  return {
    debug: base.debug.bind(base),
    info: base.info.bind(base),
    warn: base.warn.bind(base),
    error: base.error.bind(base),
    onProgress: showProgress,
    // Show task list updates in real-time
    onTaskUpdate: showTaskUpdate,
    // Show tool inputs and outputs for debugging
    onToolCall: (toolName: string, params: unknown) => {
      if (toolName.startsWith("workspace_")) {
        console.log(`\n📥 ${toolName} input:`, JSON.stringify(params, null, 2));
      }
    },
    onToolResult: (
      toolName: string,
      result: { success: boolean; data?: unknown; error?: string },
    ) => {
      if (toolName.startsWith("workspace_")) {
        const status = result.success ? "✓" : "✗";
        console.log(
          `📤 ${toolName} ${status}:`,
          JSON.stringify(result, null, 2),
        );
      }
    },
  };
}

async function main() {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    console.error("Error: OPENROUTER_API_KEY environment variable is required");
    console.error("Create a .env file with: OPENROUTER_API_KEY=your-key");
    process.exit(1);
  }

  // Per-request log dir for cache debugging. Each LLM call writes one JSON
  // file with the exact request body sent to OpenRouter and the response
  // body. To find what's busting your cache, run the same scenario twice
  // and diff the two newest files:
  //   diff <(jq -S .request <older>.json) <(jq -S .request <newer>.json)
  const logDir = process.env.OPENROUTER_LOG_DIR ?? "./openrouter-logs";
  mkdirSync(logDir, { recursive: true });
  let logCounter = 0;

  // Try the free Gemma tier first; fall back to the paid one when the free
  // tier is rate-limited, overloaded, or returns a transient error. Cost
  // accounting follows the provider that actually served each call via
  // FallbackProvider's per-response modelId stamp.
  const openRouterConfig: Omit<OpenRouterProviderConfig, "model"> = {
    apiKey,
    maxTokens: 2000,
    explicitCacheControl: true,
    onRequestLog: (entry) => {
      const file = join(logDir, `${entry.timestamp}-${logCounter++}.json`);
      writeFileSync(file, JSON.stringify(entry, null, 2));
    },
  };

  const llmProvider = new FallbackProvider({
    providers: [
      new OpenRouterProvider({
        ...openRouterConfig,
        model: "google/gemma-4-26b-a4b-it:free",
      }),
      new OpenRouterProvider({
        ...openRouterConfig,
        model: "google/gemma-4-26b-a4b-it",
      }),
      new OpenRouterProvider({
        ...openRouterConfig,
        model: "qwen/qwen3.5-27b",
      }),
    ],
    onFallback: (error, fromIndex, toIndex) => {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(
        `[fallback] provider ${fromIndex} -> ${toIndex}: ${message}`,
      );
    },
  });

  // Create workspace only when --workspace flag is set or USE_WORKSPACE=1
  // Without workspace, the agent works with tools only (in-memory meal tracking, no file persistence)
  let workspace: Workspace | undefined;

  workspace = new Workspace({
    provider: new FileWorkspaceProvider("./workspace-data"),
    strict: true, // Allow any path (set to true to restrict to defined paths only)
    paths: {
      // Meal plan with schema validation
      "plan/current.json": {
        validator: {
          type: "object",
          properties: {
            title: { type: "string" },
            goal: { type: "string" },
            dailyCalories: { type: "number" },
            days: { type: "array" },
          },
          required: ["title", "days"],
        },
      },

      // Daily totals with initial value
      "meals/today.json": {
        validator: {
          type: "object",
          properties: {
            totalCalories: { type: "number" },
            totalProtein: { type: "number" },
            totalCarbs: { type: "number" },
            totalFat: { type: "number" },
            meals: { type: "array" },
          },
        },
        value: {
          totalCalories: 0,
          totalProtein: 0,
          totalCarbs: 0,
          totalFat: 0,
          meals: [],
        },
      },

      // User preferences with schema
      "user/preferences.json": {
        validator: {
          type: "object",
          properties: {
            goal: {
              type: "string",
              enum: ["weight_loss", "muscle_gain", "maintenance", "healthy"],
            },
            restrictions: { type: "array" },
          },
        },
      },

      // Notes as markdown (format validation from extension)
      "notes/advice.md": null,

      // Analysis result as text (format validation from extension)
      "analysis/summary.txt": null,
    },
  });

  // Load persisted workspace data from disk
  await workspace.init();

  // Skills - lazy-loaded prompts for specialized workflows
  const skills: SkillConfig[] = [
    {
      name: "collect_user_profile",
      description:
        "Collect user profile: goals, body metrics, allergies, activity level",
      whenToUse:
        "New user, first conversation, or user says 'настрой меня' / 'мои данные' / 'set up my profile'",
      prompt: `Collect the user's nutrition profile step by step using __ask_user__.

Ask these questions (one at a time or grouped logically):
1. Goal: weight loss, muscle gain, maintenance, or general healthy eating
2. Current weight (kg) and height (cm)
3. Age and sex (for BMR calculation)
4. Activity level: sedentary, light (1-2x/week), moderate (3-4x/week), active (5+/week)
5. Food allergies or intolerances (if any)
6. Dietary restrictions: vegetarian, vegan, halal, kosher, none

After collecting all info, calculate their estimated daily calorie needs using Mifflin-St Jeor:
- Men: BMR = 10 * weight(kg) + 6.25 * height(cm) - 5 * age - 161
- Women: BMR = 10 * weight(kg) + 6.25 * height(cm) - 5 * age + 5
- TDEE = BMR * activity multiplier (1.2 sedentary, 1.375 light, 1.55 moderate, 1.725 active)
- Adjust for goal: -500 for weight loss, +300 for muscle gain

Save the complete profile to workspace at user/profile.json.
Present a summary with their daily targets (calories, protein, carbs, fat).
Be encouraging and supportive throughout.`,
    },
    {
      name: "log_meal",
      description:
        "Log what the user ate with nutrition data from OpenFoodFacts",
      whenToUse:
        "User mentions eating or drinking something (e.g., 'I had pasta', 'ate an apple', 'drank coffee')",
      prompt: `Log the user's meal with accurate nutrition data.

Steps:
1. Extract food items from the user's message
2. For each item, call search_food to find it in OpenFoodFacts
3. If multiple matches, pick the most relevant one (or ask user if ambiguous)
4. Ask for portion size if not specified. Suggest: small (100-150g), medium (200-250g), large (300-350g)
5. Ask which meal: breakfast, lunch, dinner, or snack (if not obvious from context/time)
6. Call log_meal for each item with the nutrition data
7. Show a brief summary: what was logged, calories, and key macros (protein, carbs, fat)

If the user mentions a dish (e.g., "Caesar salad"), search for it as-is first.
If not found, break it into components and log each.

Always be encouraging. Never judge food choices. If something is high-calorie, just present the facts neutrally.`,
    },
    {
      name: "create_meal_plan",
      description:
        "Create a personalized multi-day meal plan with calorie and macro targets",
      whenToUse:
        "User asks to plan meals, build a menu, or 'составь план питания' / 'plan my meals'",
      prompt: `Create a meal plan for the user and save it to workspace.

Steps:
1. Read user/preferences.json from workspace if it exists (goal, restrictions, allergies)
2. If goal not known, ask via __ask_user__: "What's your goal?" — options: Weight loss, Muscle gain, Maintenance, Healthy
3. If daily calorie target not known, ask: "What's your daily calorie target?" — options: 1500, 1800, 2000, 2500
4. If number of days not known, ask: "How many days should I plan?" — options: 3, 5, 7
5. Build the plan: each day has breakfast, lunch, dinner, and snacks with calorie counts
6. Write the plan to workspace at plan/current.json using workspace_write and exactly this shape:
   {
     "title": "<plan name>",
     "goal": "<user goal>",
     "dailyCalories": <number>,
     "days": [
       { "day": "Monday", "meals": { "breakfast": "...", "lunch": "...", "dinner": "...", "snacks": "..." }, "totalCalories": <N> }
     ]
   }
7. Reply with a short summary: title, days, daily calories.

Rules:
- Stay within ±100 kcal of the daily target
- Never repeat the same meal on consecutive days
- Respect every dietary restriction strictly
- Realistic portion sizes only
- Use Russian if the user is writing in Russian`,
    },
    {
      name: "analyze_day",
      description: "Analyze daily nutrition totals and give recommendations",
      whenToUse:
        "User asks for daily summary, analysis, recommendations, or 'how am I doing today'",
      prompt: `Analyze the user's nutrition for today.

Steps:
1. Call get_daily_totals to get current intake
2. Read user profile from workspace (user/profile.json) if available
3. Compare actual intake vs. targets (if profile exists)
4. Provide analysis:
   - Calories: consumed vs. target, remaining budget
   - Protein: is it sufficient? (aim for 1.6-2.2g/kg for active people, 0.8g/kg minimum)
   - Carbs and fat balance
   - Fiber: aim for 25-30g/day
5. Give 1-2 specific, actionable suggestions for the rest of the day
   (e.g., "You're low on protein - consider adding chicken or Greek yogurt to dinner")

If no meals logged yet, say so and encourage the user to start logging.
If no profile exists, suggest running the profile setup first.
Keep the tone supportive and practical.`,
    },
  ];

  // Conditional prompt pieces (issue #15).
  // Sections evaluate once at turn 1 and live in the system prompt for the
  // whole session. Injections evaluate each turn and land as synthetic
  // messages before the current user turn.
  const sections: PromptSection<EatingCtx>[] = [
    {
      name: "admin-capabilities",
      when: (ctx) => ctx.context.isAdmin,
      content:
        "The current user is an administrator. You MAY help them reset " +
        "workspace data or inspect raw JSON on request. Mention that these " +
        "admin actions exist if the user asks what you can do.",
    },
  ];

  const historyInjections: HistoryInjection<EatingCtx>[] = [
    {
      name: "opening-turn-warmup",
      when: (ctx) => ctx.turnIndex === 1,
      content:
        "This is the first turn of the conversation. Open with a short, " +
        "warm greeting acknowledging the person before jumping into food " +
        "topics. Keep it under two sentences.",
    },
  ];

  const isAdmin = process.argv.includes("--admin");
  const repository = new MemoryRepository();
  let conversationId = `eating-${Date.now()}`;

  // Trace providers: always console; add Langfuse when credentials are present.
  // MultiTraceProvider fans events out to both, isolates per-sink failures so
  // one bad provider can't take down the run, and proxies shutdown() so we can
  // flush Langfuse on exit without tracking it separately.
  const useLangfuse =
    !!process.env.LANGFUSE_PUBLIC_KEY && !!process.env.LANGFUSE_SECRET_KEY;
  const childProviders: TraceProvider[] = [
    new ConsoleTraceProvider({ showCosts: true }),
  ];
  if (useLangfuse) {
    childProviders.push(
      new LangfuseTraceProvider({
        sessionId: conversationId,
        userId: process.env.USER ?? "local",
        tags: ["eating-consultant"],
      }),
    );
  }
  const traceProvider = new MultiTraceProvider(childProviders);
  console.log(
    `Tracing: console${useLangfuse ? " + Langfuse" : ""} (via MultiTraceProvider)`,
  );

  // Flush any buffered trace events before the process exits.
  const shutdownTracing = async () => {
    await traceProvider.shutdown();
  };
  process.on("beforeExit", shutdownTracing);
  process.on("SIGINT", async () => {
    await shutdownTracing();
    process.exit(0);
  });

  // Create the main agent: skills-only, no sub-agents
  const agent = new Tuplet({
    role:
      "a nutrition consultant that helps users track meals, view nutrition progress, and plan their diet. " +
      "You have skills for specific workflows - activate them when the user's request matches. " +
      "Present results in a friendly, encouraging way. Use Russian if user speaks Russian.",
    tools: nutritionCounterTools,
    skills,
    agents: [],
    llm: llmProvider,
    repository,
    sections,
    historyInjections,
    allowedUrls: ["https://*.openfoodfacts.org/**"],
    logger: createProgressLogger(),
    maxIterations: 15,
    trace: traceProvider,
    agentName: "eating_consultant",
    recorder: new RunRecorder({ outputDir: "./runs" }),
  });

  const runContext: EatingCtx = { isAdmin, locale: "en" };

  let history: Message[] = [];
  let currentController: AbortController | null = null;
  let isProcessing = false;

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  // Setup ESC key handler for interruption during processing
  function setupEscHandler() {
    if (!process.stdin.isTTY) return;

    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.once("data", (key) => {
      // ESC key (27) or Ctrl+C (3)
      if (key[0] === 27) {
        if (currentController && isProcessing) {
          // Stop immediately to prevent re-registration
          isProcessing = false;
          console.log("\n\n⛔ Interrupted by ESC");
          currentController.abort();
          currentController = null;
          stopEscHandler();
          return;
        }
      } else if (key[0] === 3) {
        console.log("\nGoodbye!\n");
        void shutdownTracing().finally(() => process.exit(0));
        return;
      }
      // Continue listening if still processing
      if (isProcessing) {
        setupEscHandler();
      }
    });
  }

  function stopEscHandler() {
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(false);
    }
  }

  console.log("\n" + "=".repeat(60));
  console.log("  Eating Consultant - Powered by OpenFoodFacts");
  console.log("=".repeat(60));
  console.log(
    `\nWorkspace: ${workspace ? "enabled (--workspace)" : "disabled (tools-only mode)"}`,
  );
  console.log(`Admin mode: ${isAdmin ? "on (--admin)" : "off"}`);
  console.log('Commands: "quit" to exit, "clear" to reset');
  console.log("Press ESC to interrupt a running task");
  console.log("");

  // Get initial greeting
  {
    isProcessing = true;
    currentController = new AbortController();
    setupEscHandler();

    const greeting = await agent.run(
      "Start the conversation with a greeting.",
      {
        history,
        conversationId,
        context: runContext,
        signal: currentController.signal,
        workspace,
      },
    );

    stopEscHandler();
    isProcessing = false;
    currentController = null;
    history = greeting.history;

    if (greeting.status === "error") {
      console.error("\n❌ Error:", greeting.error, "\n");
    } else {
      console.log("\nAssistant:", greeting.response, "\n");
      if (
        greeting.firedPromptSections &&
        greeting.firedPromptSections.length > 0
      ) {
        console.log(
          `🧩 Active prompt sections: ${greeting.firedPromptSections.join(", ")}\n`,
        );
      }
      if (
        greeting.firedHistoryInjections &&
        greeting.firedHistoryInjections.length > 0
      ) {
        console.log(
          `💬 Fired history injections: ${greeting.firedHistoryInjections.join(", ")}\n`,
        );
      }
    }
  }

  const prompt = () => {
    rl.question("You: ", async (input) => {
      const trimmed = input.trim();

      if (!trimmed) {
        prompt();
        return;
      }

      if (trimmed.toLowerCase() === "quit") {
        console.log("\nGoodbye! Eat well!\n");
        rl.close();
        await shutdownTracing();
        process.exit(0);
      }

      if (trimmed.toLowerCase() === "clear") {
        history = [];
        conversationId = `eating-${Date.now()}`;
        console.log("\n--- Conversation cleared ---\n");
        prompt();
        return;
      }

      try {
        isProcessing = true;
        currentController = new AbortController();
        setupEscHandler();

        const result = await agent.run(trimmed, {
          history,
          conversationId,
          context: runContext,
          signal: currentController.signal,
          workspace,
        });

        stopEscHandler();
        isProcessing = false;
        currentController = null;

        // Always preserve history — even on error or interrupt
        history = result.history;

        if (result.status === "error") {
          console.log(`\n❌ Error: ${result.error}`);
          console.log(
            '(History saved. Send a new message to retry or "clear" to reset)\n',
          );
          prompt();
          return;
        }

        if (result.status === "interrupted") {
          console.log(
            `\n⚠️  Task interrupted after ${result.interrupted?.iterationsCompleted} iterations`,
          );
          console.log(
            '(Partial work saved. Send a new message to continue or "clear" to reset)\n',
          );
          prompt();
          return;
        }

        // Variable to track the final result to display
        let finalResult = result;
        let currentResult = result;

        // Handle question/answer loop until complete or interrupted
        while (
          currentResult.status === "needs_input" &&
          currentResult.pendingQuestion
        ) {
          displayPendingQuestion(currentResult.pendingQuestion);

          // Collect all answers and auto-continue
          const combinedAnswer = await handleMultiQuestion(
            rl,
            currentResult.pendingQuestion!.questions,
          );
          console.log("\n✅ Answers collected, continuing...\n");

          // Auto-continue with the collected answers
          isProcessing = true;
          currentController = new AbortController();
          setupEscHandler();

          const continuedResult = await agent.run(combinedAnswer, {
            history: currentResult.history,
            conversationId,
            context: runContext,
            signal: currentController.signal,
            workspace,
          });

          stopEscHandler();
          isProcessing = false;
          currentController = null;

          // Update for next iteration or final display
          currentResult = continuedResult;
          finalResult = continuedResult;
          history = continuedResult.history;
        }

        // Show final result
        if (currentResult.status === "error") {
          console.log(`\n❌ Error: ${currentResult.error}`);
        } else if (currentResult.status === "complete") {
          console.log("\nAssistant:", currentResult.response);
        } else if (currentResult.status === "interrupted") {
          console.log(
            `\n⚠️  Task interrupted after ${currentResult.interrupted?.iterationsCompleted} iterations`,
          );
        }

        // Show fired prompt sections (active set for the session)
        if (
          finalResult.firedPromptSections &&
          finalResult.firedPromptSections.length > 0
        ) {
          console.log(
            `\n🧩 Active prompt sections: ${finalResult.firedPromptSections.join(", ")}`,
          );
        }

        // Show fired history injections (delta for this run)
        if (
          finalResult.firedHistoryInjections &&
          finalResult.firedHistoryInjections.length > 0
        ) {
          console.log(
            `\n💬 Fired history injections: ${finalResult.firedHistoryInjections.join(", ")}`,
          );
        }

        // Show tasks if any (from final result)
        if (finalResult.tasks && finalResult.tasks.length > 0) {
          console.log("\n📋 Tasks:");
          finalResult.tasks.forEach((task) => {
            const icon =
              task.status === "completed"
                ? "✅"
                : task.status === "in_progress"
                  ? "🔄"
                  : "⬜";
            const blocked = task.blockedBy?.length
              ? ` (blocked by: ${task.blockedBy.join(", ")})`
              : "";
            console.log(`  ${task.id}. ${icon} ${task.subject}${blocked}`);
          });
        }

        // Show usage from trace
        if (finalResult.trace) {
          const trace = finalResult.trace;
          console.log("\n📊 Usage:");
          console.log(
            `  Total: ${trace.totalInputTokens} in / ${trace.totalOutputTokens} out`,
          );
          console.log(
            `  Cache: ${trace.totalCacheReadTokens} read / ${trace.totalCacheCreationTokens} write`,
          );
          if (trace.totalCost > 0) {
            console.log(`  Cost: $${trace.totalCost.toFixed(4)}`);
          }
          if (trace.costByModel && Object.keys(trace.costByModel).length > 0) {
            for (const modelId of Object.keys(trace.costByModel)) {
              const usage = trace.costByModel[modelId];
              console.log(
                `  ${modelId}: ${usage.inputTokens} in / ${usage.outputTokens} out, ${usage.cacheReadTokens} cache-read / ${usage.cacheCreationTokens} cache-write (${usage.calls} calls)`,
              );
            }
          }
        }

        // Check if a plan was saved to workspace (only when workspace is enabled)
        if (workspace) {
          const plan = await workspace.read<{
            title?: string;
            goal?: string;
            dailyCalories?: number;
            days?: unknown[];
          }>("plan/current.json");
          if (plan) {
            console.log("\n📝 Plan saved to workspace:");
            console.log(`  Title: ${plan.title || "Meal Plan"}`);
            if (plan.goal) {
              console.log(`  Goal: ${plan.goal}`);
            }
            if (plan.dailyCalories) {
              console.log(`  Daily calories: ${plan.dailyCalories} kcal`);
            }
            if (plan.days && Array.isArray(plan.days)) {
              console.log(`  Days planned: ${plan.days.length}`);
            }
          }

          // Show all workspace entries if any exist
          const workspaceItems = await workspace.list();
          if (workspaceItems.length > 0) {
            console.log("\n📦 Workspace:");
            for (const item of workspaceItems) {
              console.log(`  ${item.path}: ${item.preview}`);
            }
          }
        }

        console.log("");
      } catch (error) {
        stopEscHandler();
        isProcessing = false;
        currentController = null;
        console.error("Error:", error instanceof Error ? error.message : error);
        console.log("");
      }

      prompt();
    });
  };

  prompt();
}

main().catch(console.error);
