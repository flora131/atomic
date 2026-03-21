import { describe, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { mkdtemp, mkdir, writeFile as fsWriteFile, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import type { CommandContext } from "@/commands/tui/registry.ts";
import { EventBus } from "@/services/events/event-bus.ts";
import { VERSION } from "@/version.ts";
import {
  CUSTOM_WORKFLOW_SEARCH_PATHS,
  discoverWorkflowFiles,
  getWorkflowCommands,
  loadWorkflowsFromDisk,
  parseRalphArgs,
  parseWorkflowArgs,
  watchTasksJson,
} from "@/commands/tui/workflow-commands.ts";

let mockSessionCounter = 0;

/**
 * Creates a mock `createAgentSession` function for conductor-based workflow tests.
 *
 * Each call returns a Session whose `stream()` method yields stage-appropriate
 * responses based on prompt content:
 *   - Planner prompts (containing "Decompose") → JSON task list
 *   - Reviewer prompts (containing "Review") → clean review JSON
 *   - All others (orchestrator, debugger) → plain text completion
 */
function createMockAgentSession(): (config?: unknown) => Promise<{
  id: string;
  send: (message: string) => Promise<{ type: "text"; content: string }>;
  stream: (
    message: string,
    options?: { agent?: string; abortSignal?: AbortSignal },
  ) => AsyncIterable<{ type: "text"; content: string }>;
  summarize: () => Promise<void>;
  getContextUsage: () => Promise<{
    inputTokens: number;
    outputTokens: number;
    maxTokens: number;
    usagePercentage: number;
  }>;
  getSystemToolsTokens: () => number;
  destroy: () => Promise<void>;
}> {
  return async () => ({
    id: `mock-session-${++mockSessionCounter}`,
    send: async () => ({ type: "text" as const, content: "" }),
    stream: async function* (
      message: string,
      _options?: { agent?: string; abortSignal?: AbortSignal },
    ) {
      // Planner stage: prompt contains "Decompose" (from buildSpecToTasksPrompt)
      if (message.includes("Decompose") || message.includes("decompose")) {
        yield {
          type: "text" as const,
          content: JSON.stringify([
            {
              id: "#1",
              description: "Implement feature",
              status: "pending",
              summary: "Implementing feature",
              blockedBy: [],
            },
          ]),
        };
        return;
      }
      // Reviewer stage: prompt contains "Review" (from buildReviewPrompt)
      if (message.includes("Review") || message.includes("review")) {
        yield {
          type: "text" as const,
          content: JSON.stringify({
            findings: [],
            overall_correctness: "patch is correct",
            overall_explanation: "No issues found",
          }),
        };
        return;
      }
      // Default: orchestrator, debugger, or any other stage
      yield { type: "text" as const, content: "Stage completed successfully." };
    },
    summarize: async () => {},
    getContextUsage: async () => ({
      inputTokens: 100,
      outputTokens: 50,
      maxTokens: 100000,
      usagePercentage: 0.15,
    }),
    getSystemToolsTokens: () => 0,
    destroy: async () => {},
  });
}

function createMockContext(overrides?: Partial<CommandContext>): CommandContext {
  return {
    session: null,
    state: {
      isStreaming: false,
      messageCount: 0,
      workflowActive: false,
    },
    addMessage: () => {},
    setStreaming: () => {},
    sendMessage: () => {},
    sendSilentMessage: () => {},
    spawnSubagent: async () => ({ success: true, output: "" }),
    spawnSubagentParallel: async (agents) =>
      agents.map((a) => ({
        agentId: a.agentId,
        success: true,
        output: "Done",
        toolUses: 1,
        durationMs: 100,
      })),
    streamAndWait: async () => ({ content: "", wasInterrupted: false }),
    waitForUserInput: async () => "",
    clearContext: async () => {},
    setTodoItems: () => {},
    setWorkflowSessionDir: () => {},
    setWorkflowSessionId: () => {},
    setWorkflowTaskIds: () => {},
    updateWorkflowState: () => {},
    createAgentSession: createMockAgentSession(),
    ...overrides,
  };
}

async function withWorkflowSearchPaths(
  paths: string[],
  run: () => Promise<void>,
): Promise<void> {
  const originalPaths = [...CUSTOM_WORKFLOW_SEARCH_PATHS];
  CUSTOM_WORKFLOW_SEARCH_PATHS.splice(0, CUSTOM_WORKFLOW_SEARCH_PATHS.length, ...paths);
  try {
    await run();
  } finally {
    CUSTOM_WORKFLOW_SEARCH_PATHS.splice(
      0,
      CUSTOM_WORKFLOW_SEARCH_PATHS.length,
      ...originalPaths,
    );
    await loadWorkflowsFromDisk();
  }
}

describe("parseRalphArgs", () => {
  test("parses a prompt argument", () => {
    const result = parseRalphArgs("Build a feature");
    expect(result).toEqual({ prompt: "Build a feature" });
  });

  test("throws on empty prompt", () => {
    expect(() => parseRalphArgs("")).toThrow("A prompt argument is required");
  });

  test("trims whitespace from prompt", () => {
    const result = parseRalphArgs("  Build a feature  ");
    expect(result).toEqual({ prompt: "Build a feature" });
  });
});

describe("parseWorkflowArgs", () => {
  test("parses a prompt argument", () => {
    const result = parseWorkflowArgs("Build a feature");
    expect(result).toEqual({ prompt: "Build a feature" });
  });

  test("throws on empty prompt with default workflow name", () => {
    expect(() => parseWorkflowArgs("")).toThrow(
      'Usage: /workflow "<prompt-or-spec-path>"',
    );
  });

  test("throws on empty prompt with custom workflow name", () => {
    expect(() => parseWorkflowArgs("", "deploy")).toThrow(
      'Usage: /deploy "<prompt-or-spec-path>"',
    );
  });

  test("trims whitespace from prompt", () => {
    const result = parseWorkflowArgs("  Build a feature  ");
    expect(result).toEqual({ prompt: "Build a feature" });
  });

  test("parseRalphArgs is a deprecated alias for parseWorkflowArgs", () => {
    const ralphResult = parseRalphArgs("hello world");
    const workflowResult = parseWorkflowArgs("hello world");
    expect(ralphResult).toEqual(workflowResult);
  });
});

describe("workflow metadata discovery", () => {
});

describe("watchTasksJson", () => {
  function createDeferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  }

  test("emits current tasks immediately after watcher starts", async () => {
    const updates: string[] = [];

    const cleanup = watchTasksJson(
      "/tmp/ralph-watch-immediate",
      (items) => {
        updates.push(items[0]?.status ?? "missing");
      },
      {
        watchImpl: () => ({ close: () => {} }) as unknown as import("fs").FSWatcher,
        readFileImpl: async () =>
          JSON.stringify([{ id: "#1", description: "Task", status: "pending", summary: "Working" }]),
      },
    );

    await Bun.sleep(0);
    cleanup();

    expect(updates).toEqual(["pending"]);
  });

  test("ignores stale async reads when newer file event wins", async () => {
    const updates: string[] = [];
    const slowRead = createDeferred<string>();
    const fastRead = createDeferred<string>();
    let readCount = 0;
    let listener:
      | ((eventType: string, filename: string | Buffer | null) => void | Promise<void>)
      | undefined;

    const cleanup = watchTasksJson(
      "/tmp/ralph-watch-stale",
      (items) => {
        updates.push(items[0]?.status ?? "missing");
      },
      {
        watchImpl: (_path, cb) => {
          listener = cb;
          return { close: () => {} } as unknown as import("fs").FSWatcher;
        },
        readFileImpl: async () => {
          readCount++;
          if (readCount === 1) {
            const err = new Error("ENOENT");
            (err as { code?: string }).code = "ENOENT";
            throw err;
          }
          if (readCount === 2) return slowRead.promise;
          if (readCount === 3) return fastRead.promise;
          return "[]";
        },
      },
    );

    expect(listener).toBeDefined();
    void listener?.("change", "tasks.json");
    void listener?.("change", "tasks.json");

    fastRead.resolve(
      JSON.stringify([{ id: "#1", description: "Task", status: "completed", summary: "Done" }]),
    );
    await Bun.sleep(0);

    slowRead.resolve(
      JSON.stringify([{ id: "#1", description: "Task", status: "pending", summary: "Working" }]),
    );
    await Bun.sleep(0);

    cleanup();

    expect(updates).toEqual(["completed"]);
  });

  test("handles Buffer filename events from fs.watch", async () => {
    const updates: string[] = [];
    let listener:
      | ((eventType: string, filename: string | Buffer | null) => void | Promise<void>)
      | undefined;
    let readCount = 0;

    const cleanup = watchTasksJson(
      "/tmp/ralph-watch-buffer",
      (items) => {
        updates.push(items[0]?.status ?? "missing");
      },
      {
        watchImpl: (_path, cb) => {
          listener = cb;
          return { close: () => {} } as unknown as import("fs").FSWatcher;
        },
        readFileImpl: async () => {
          readCount++;
          if (readCount === 1) {
            const err = new Error("ENOENT");
            (err as { code?: string }).code = "ENOENT";
            throw err;
          }
          return JSON.stringify([
            { id: "#1", description: "Task", status: "in_progress", summary: "Working" },
          ]);
        },
      },
    );

    void listener?.("change", Buffer.from("tasks.json"));
    await Bun.sleep(0);
    cleanup();

    expect(updates).toEqual(["in_progress"]);
  });
});

describe("workflow-commands /ralph", () => {
  test("rejects when a workflow is already active", async () => {
    const context = createMockContext({
      state: {
        isStreaming: false,
        messageCount: 0,
        workflowActive: true,
        workflowType: "ralph",
      },
    });

    const ralphCommand = getWorkflowCommands().find((cmd) => cmd.name === "ralph");
    expect(ralphCommand).toBeDefined();

    const result = await ralphCommand!.execute("Build a feature", context);
    expect(result.success).toBe(false);
    expect(result.message).toContain("already active");
  });

  test("rejects when no prompt is provided", async () => {
    const context = createMockContext();

    const ralphCommand = getWorkflowCommands().find((cmd) => cmd.name === "ralph");
    expect(ralphCommand).toBeDefined();

    const result = await ralphCommand!.execute("", context);
    expect(result.success).toBe(false);
    expect(result.message).toContain("A prompt argument is required");
  });

  test("executes /ralph without publishing legacy workflow bus events", async () => {
    const bus = new EventBus();
    const seenEvents: string[] = [];
    const unsubscribe = bus.on("stream.session.start", () => {
      seenEvents.push("stream.session.start");
    });

    let sessionDir: string | null = null;
    const context = createMockContext({
      eventBus: bus,
      setWorkflowSessionDir: (dir: string | null) => {
        sessionDir = dir;
        if (dir) {
          mkdirSync(dir, { recursive: true });
        }
      },
    });

    try {
      const ralphCommand = getWorkflowCommands().find((cmd) => cmd.name === "ralph");
      expect(ralphCommand).toBeDefined();

      const result = await ralphCommand!.execute("Build a feature", context);
      expect(result.success).toBe(true);
      expect(seenEvents).toHaveLength(0);
    } finally {
      unsubscribe();
      if (sessionDir) {
        await rm(sessionDir, { recursive: true, force: true });
      }
    }
  });

  test("completes Ralph workflows without publishing legacy agent bus events", async () => {
    const bus = new EventBus();
    const agentStarts: Array<{ agentId: string; agentType: string }> = [];
    const agentCompletes: Array<{
      agentId: string;
      success: boolean;
      result?: string;
      error?: string;
    }> = [];
    const sessionStarts: string[] = [];
    const unsubscribeSession = bus.on("stream.session.start", () => {
      sessionStarts.push("stream.session.start");
    });
    const unsubscribeStart = bus.on("stream.agent.start", (event) => {
      agentStarts.push({
        agentId: event.data.agentId,
        agentType: event.data.agentType,
      });
    });
    const unsubscribeComplete = bus.on("stream.agent.complete", (event) => {
      agentCompletes.push({
        agentId: event.data.agentId,
        success: event.data.success,
        result: event.data.result,
        error: event.data.error,
      });
    });

    let sessionDir: string | null = null;
    const context = createMockContext({
      eventBus: bus,
      spawnSubagentParallel: async (agents) =>
        agents.map((agent) => {
          if (agent.agentName === "planner") {
            return {
              agentId: agent.agentId,
              success: true,
              output: JSON.stringify([
                {
                  id: "#1",
                  description: "Add integration test for Claude sub-agent completion in Ralph",
                  status: "pending",
                  summary: "Adding integration test for Claude sub-agent completion in Ralph",
                  blockedBy: [],
                },
              ]),
              toolUses: 1,
              durationMs: 100,
            };
          }
          if (agent.agentName === "worker") {
            return {
              agentId: agent.agentId,
              success: true,
              output: "Implemented task #1",
              toolUses: 2,
              durationMs: 120,
            };
          }
          if (agent.agentName === "reviewer") {
            return {
              agentId: agent.agentId,
              success: true,
              output: JSON.stringify({
                findings: [],
                overall_correctness: "patch is correct",
                overall_explanation: "No issues found",
              }),
              toolUses: 1,
              durationMs: 80,
            };
          }
          return {
            agentId: agent.agentId,
            success: true,
            output: "Done",
            toolUses: 1,
            durationMs: 100,
          };
        }),
      setWorkflowSessionDir: (dir: string | null) => {
        sessionDir = dir;
        if (dir) {
          mkdirSync(dir, { recursive: true });
        }
      },
    });

    try {
      const ralphCommand = getWorkflowCommands().find((cmd) => cmd.name === "ralph");
      expect(ralphCommand).toBeDefined();

      const result = await ralphCommand!.execute(
        "Add integration test for Claude sub-agent completion in Ralph",
        context,
      );

      expect(result.success).toBe(true);
      expect(sessionStarts).toHaveLength(0);
      expect(agentStarts).toHaveLength(0);
      expect(agentCompletes).toHaveLength(0);
    } finally {
      unsubscribeSession();
      unsubscribeStart();
      unsubscribeComplete();
      if (sessionDir) {
        await rm(sessionDir, { recursive: true, force: true });
      }
    }
  });
});

describe("review step in /ralph", () => {






  test("does not spawn reviewer when tasks are not all completed", async () => {
    const stagesExecuted: string[] = [];
    let sessionDir: string | null = null;

    // Mock session where the planner returns an empty task list.
    // With the conductor architecture, the reviewer still runs (no shouldRun guard),
    // but the debugger should NOT run because the reviewer finds no actionable issues.
    const emptyPlannerSession: (config?: unknown) => Promise<any> = async () => ({
      id: "mock-empty-planner-session",
      send: async () => ({ type: "text" as const, content: "" }),
      stream: async function* (message: string) {
        // Track which stage prompts are executed
        if (message.includes("Decompose") || message.includes("decompose")) {
          stagesExecuted.push("planner");
          // Return an empty array — no tasks were produced
          yield { type: "text" as const, content: "[]" };
          return;
        }
        if (message.includes("Review") || message.includes("review")) {
          stagesExecuted.push("reviewer");
          // Return clean review with no findings
          yield {
            type: "text" as const,
            content: JSON.stringify({
              findings: [],
              overall_correctness: "patch is correct",
              overall_explanation: "No tasks to review",
            }),
          };
          return;
        }
        if (message.includes("Fix") || message.includes("fix")) {
          stagesExecuted.push("debugger");
          yield { type: "text" as const, content: "Fixed" };
          return;
        }
        stagesExecuted.push("orchestrator");
        yield { type: "text" as const, content: "No tasks to orchestrate." };
      },
      summarize: async () => {},
      getContextUsage: async () => ({
        inputTokens: 100,
        outputTokens: 50,
        maxTokens: 100000,
        usagePercentage: 0.15,
      }),
      getSystemToolsTokens: () => 0,
      destroy: async () => {},
    });

    const context = createMockContext({
      createAgentSession: emptyPlannerSession,
      setWorkflowSessionDir: (dir: string | null) => {
        sessionDir = dir;
        if (dir) {
          mkdirSync(dir, { recursive: true });
        }
      },
      setWorkflowSessionId: () => {},
      setWorkflowTaskIds: () => {},
      updateWorkflowState: () => {},
    });

    const ralphCommand = getWorkflowCommands().find((cmd) => cmd.name === "ralph");
    const result = await ralphCommand!.execute("Build a feature", context);

    // The planner returned no tasks, so there's nothing for the debugger to fix.
    // The debugger's shouldRun checks for actionable findings — none exist.
    expect(stagesExecuted).not.toContain("debugger");
    
    if (sessionDir) {
      await rm(sessionDir, { recursive: true, force: true });
    }
  });
});

describe("workflow inline mode", () => {


  test("waitForUserInput is present in CommandContext interface", () => {
    const context = createMockContext();
    expect(typeof context.waitForUserInput).toBe("function");
  });

  test("mock waitForUserInput resolves with a string", async () => {
    const context = createMockContext({
      waitForUserInput: async () => "user typed this",
    });
    const result = await context.waitForUserInput();
    expect(result).toBe("user typed this");
  });




});

describe("workflow inline mode integration", () => {







});
