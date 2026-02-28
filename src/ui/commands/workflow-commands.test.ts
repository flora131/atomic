import { describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, writeFile as fsWriteFile, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import type { CommandContext } from "./registry.ts";
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
