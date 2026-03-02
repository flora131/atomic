import { describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, writeFile as fsWriteFile, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import type { CommandContext } from "./registry.ts";
import { EventBus } from "../../events/event-bus.ts";
import { VERSION } from "../../version.ts";
import {
  CUSTOM_WORKFLOW_SEARCH_PATHS,
  discoverWorkflowFiles,
  getWorkflowCommands,
  loadWorkflowsFromDisk,
  parseRalphArgs,
  watchTasksJson,
} from "./workflow-commands.ts";

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
          JSON.stringify([{ id: "#1", content: "Task", status: "pending", activeForm: "Working" }]),
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
      JSON.stringify([{ id: "#1", content: "Task", status: "completed", activeForm: "Done" }]),
    );
    await Bun.sleep(0);

    slowRead.resolve(
      JSON.stringify([{ id: "#1", content: "Task", status: "pending", activeForm: "Working" }]),
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
            { id: "#1", content: "Task", status: "in_progress", activeForm: "Working" },
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

  test("forwards context.eventBus to executeWorkflow and publishes stream.session.start", async () => {
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
          const { mkdirSync } = require("fs");
          mkdirSync(dir, { recursive: true });
        }
      },
    });

    try {
      const ralphCommand = getWorkflowCommands().find((cmd) => cmd.name === "ralph");
      expect(ralphCommand).toBeDefined();

      await ralphCommand!.execute("Build a feature", context);
      expect(seenEvents.length).toBeGreaterThan(0);
    } finally {
      unsubscribe();
      if (sessionDir) {
        await rm(sessionDir, { recursive: true, force: true });
      }
    }
  });

  test("publishes Ralph sub-agent completion events for successful execution", async () => {
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
                  content: "Add integration test for Claude sub-agent completion in Ralph",
                  status: "pending",
                  activeForm: "Adding integration test for Claude sub-agent completion in Ralph",
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
          const { mkdirSync } = require("fs");
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
      expect(sessionStarts.length).toBeGreaterThan(0);
      expect(
        agentStarts.some(
          (event) => event.agentType === "planner" && event.agentId.startsWith("planner-"),
        ),
      ).toBe(true);
      expect(
        agentCompletes.some(
          (event) =>
            event.agentId.startsWith("planner-")
            && event.success
            && event.result?.includes('"id":"#1"'),
        ),
      ).toBe(true);
      expect(
        agentCompletes.some(
          (event) => event.agentId === "worker-#1" && event.success && event.result === "Implemented task #1",
        ),
      ).toBe(true);
      expect(
        agentCompletes.some(
          (event) =>
            event.agentId.startsWith("reviewer-")
            && event.success
            && event.result?.includes('"overall_correctness":"patch is correct"'),
        ),
      ).toBe(true);
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
    const spawnCalls: Array<{ name?: string }> = [];
    let sessionDir: string | null = null;

    const context = createMockContext({
      streamAndWait: async () => {
        return {
          content: JSON.stringify([
            { id: "#1", content: "Test task", status: "pending", activeForm: "Testing" },
          ]),
          wasInterrupted: false,
        };
      },
      spawnSubagentParallel: async (agents) =>
        agents.map((a) => ({
          agentId: a.agentId,
          success: false,
          output: "Error: failed",
          toolUses: 0,
          durationMs: 100,
        })),
      spawnSubagent: async (options) => {
        spawnCalls.push({ name: options.name });
        return { success: true, output: "" };
      },
      setWorkflowSessionDir: (dir: string | null) => {
        sessionDir = dir;
        if (dir) {
          const { mkdirSync } = require("fs");
          mkdirSync(dir, { recursive: true });
        }
      },
      setWorkflowSessionId: () => {},
      setWorkflowTaskIds: () => {},
      updateWorkflowState: () => {},
    });

    const ralphCommand = getWorkflowCommands().find((cmd) => cmd.name === "ralph");
    const result = await ralphCommand!.execute("Build a feature", context);
    // When the planner subagent fails, the workflow should report failure
    expect(result.success).toBe(false);
    
    // Reviewer should NOT be spawned since not all tasks completed
    expect(spawnCalls.length).toBe(0);
    
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
