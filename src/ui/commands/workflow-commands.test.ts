import { describe, expect, test } from "bun:test";
import { mkdtemp, writeFile as fsWriteFile, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import type { CommandContext } from "./registry.ts";
import { getWorkflowCommands, parseRalphArgs, watchTasksJson } from "./workflow-commands.ts";

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
    setRalphSessionDir: () => {},
    setRalphSessionId: () => {},
    setRalphTaskIds: () => {},
    updateWorkflowState: () => {},
    ...overrides,
  };
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
  test("spawns reviewer sub-agent when all tasks complete", async () => {
    const spawnCalls: Array<{ name?: string; message: string }> = [];
    let streamCallCount = 0;
    let clearCallCount = 0;

    // Mock tasks.json by creating a temp directory
    const tempDir = await mkdtemp(join(tmpdir(), "ralph-test-"));
    const tasksJson = JSON.stringify([
      { id: "#1", content: "Test task", status: "completed", activeForm: "Testing" },
    ]);
    
    // We need to write tasks.json to the session dir. But sessionId is random.
    // So we'll track setRalphSessionDir to know the directory.
    let sessionDir: string | null = null;
    
    const context = createMockContext({
      streamAndWait: async (prompt: string, options?: { hideContent?: boolean }) => {
        streamCallCount++;
        if (streamCallCount === 1) {
          // Step 1: Return task list
          return {
            content: JSON.stringify([
              { id: "#1", content: "Test task", status: "pending", activeForm: "Testing" },
            ]),
            wasInterrupted: false,
          };
        }
        // Step 2 and beyond: return empty (simulates agent doing work)
        // After this, the loop reads tasks from disk
        if (sessionDir) {
          // Write completed tasks to disk so the loop sees completion
          await fsWriteFile(
            join(sessionDir, "tasks.json"),
            JSON.stringify([
              { id: "#1", content: "Test task", status: "completed", activeForm: "Testing" },
            ])
          );
        }
        return { content: "", wasInterrupted: false };
      },
      spawnSubagent: async (options) => {
        spawnCalls.push({ name: options.name, message: options.message });
        // Return a valid review with no actionable findings
        return {
          success: true,
          output: JSON.stringify({
            findings: [],
            overall_correctness: "patch is correct",
            overall_explanation: "All changes look good",
            overall_confidence_score: 0.95,
          }),
        };
      },
      clearContext: async () => {
        clearCallCount++;
      },
      setRalphSessionDir: (dir: string | null) => {
        sessionDir = dir;
        // Create the directory for tasks.json
        if (dir) {
          const { mkdirSync } = require("fs");
          mkdirSync(dir, { recursive: true });
        }
      },
      setRalphSessionId: () => {},
      setRalphTaskIds: () => {},
      updateWorkflowState: () => {},
    });

    const ralphCommand = getWorkflowCommands().find((cmd) => cmd.name === "ralph");
    expect(ralphCommand).toBeDefined();

    const result = await ralphCommand!.execute("Build a feature", context);
    expect(result.success).toBe(true);
    
    // Verify reviewer was spawned
    expect(spawnCalls.length).toBeGreaterThanOrEqual(1);
    expect(spawnCalls[0]?.name).toBe("reviewer");
    expect(spawnCalls[0]?.message).toContain("Code Review Request");
    
    // Cleanup
    await rm(tempDir, { recursive: true, force: true });
    if (sessionDir) {
      await rm(sessionDir, { recursive: true, force: true });
    }
  });

  test("stops implementation loop when pending tasks are dependency-blocked", async () => {
    let streamCallCount = 0;
    let sessionDir: string | null = null;

    const context = createMockContext({
      streamAndWait: async () => {
        streamCallCount++;

        if (streamCallCount === 1) {
          return {
            content: JSON.stringify([
              { id: "#1", content: "Failing root task", status: "pending", activeForm: "Working" },
              {
                id: "#2",
                content: "Blocked follow-up",
                status: "pending",
                activeForm: "Waiting",
                blockedBy: ["#1"],
              },
            ]),
            wasInterrupted: false,
          };
        }

        return { content: "", wasInterrupted: false };
      },
      spawnSubagentParallel: async (agents) =>
        agents.map((a) => ({
          agentId: a.agentId,
          success: false,
          output: "Error: task failed",
          toolUses: 0,
          durationMs: 100,
        })),
      setRalphSessionDir: (dir: string | null) => {
        sessionDir = dir;
        if (dir) {
          const { mkdirSync } = require("fs");
          mkdirSync(dir, { recursive: true });
        }
      },
      setRalphSessionId: () => {},
      setRalphTaskIds: () => {},
      updateWorkflowState: () => {},
    });

    const ralphCommand = getWorkflowCommands().find((cmd) => cmd.name === "ralph");
    const result = await ralphCommand!.execute("Build a feature", context);
    expect(result.success).toBe(true);
    expect(streamCallCount).toBe(1);

    if (sessionDir) {
      await rm(sessionDir, { recursive: true, force: true });
    }
  });

  test("continues implementation loop when blockedBy uses non-prefixed IDs", async () => {
    let streamCallCount = 0;
    let sessionDir: string | null = null;
    let parallelCallCount = 0;

    const context = createMockContext({
      streamAndWait: async () => {
        streamCallCount++;

        if (streamCallCount === 1) {
          return {
            content: JSON.stringify([
              { id: "#1", content: "Root task", status: "pending", activeForm: "Working" },
              {
                id: "#2",
                content: "Dependent task",
                status: "pending",
                activeForm: "Waiting",
                blockedBy: ["1"],
              },
            ]),
            wasInterrupted: false,
          };
        }

        return { content: "", wasInterrupted: false };
      },
      spawnSubagentParallel: async (agents) => {
        parallelCallCount++;
        return agents.map((a) => ({
          agentId: a.agentId,
          success: true,
          output: "Done",
          toolUses: 1,
          durationMs: 100,
        }));
      },
      setRalphSessionDir: (dir: string | null) => {
        sessionDir = dir;
        if (dir) {
          const { mkdirSync } = require("fs");
          mkdirSync(dir, { recursive: true });
        }
      },
      setRalphSessionId: () => {},
      setRalphTaskIds: () => {},
      updateWorkflowState: () => {},
    });

    const ralphCommand = getWorkflowCommands().find((cmd) => cmd.name === "ralph");
    const result = await ralphCommand!.execute("Build a feature", context);
    expect(result.success).toBe(true);
    expect(streamCallCount).toBe(1);
    // Two iterations: first dispatches #1, second dispatches #2
    expect(parallelCallCount).toBe(2);

    if (sessionDir) {
      await rm(sessionDir, { recursive: true, force: true });
    }
  });

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
      setRalphSessionDir: (dir: string | null) => {
        sessionDir = dir;
        if (dir) {
          const { mkdirSync } = require("fs");
          mkdirSync(dir, { recursive: true });
        }
      },
      setRalphSessionId: () => {},
      setRalphTaskIds: () => {},
      updateWorkflowState: () => {},
    });

    const ralphCommand = getWorkflowCommands().find((cmd) => cmd.name === "ralph");
    const result = await ralphCommand!.execute("Build a feature", context);
    expect(result.success).toBe(true);
    
    // Reviewer should NOT be spawned since not all tasks completed
    expect(spawnCalls.length).toBe(0);
    
    if (sessionDir) {
      await rm(sessionDir, { recursive: true, force: true });
    }
  });

  test("re-invokes ralph when review has actionable findings", async () => {
    let streamCallCount = 0;
    let sessionDir: string | null = null;
    const spawnCalls: Array<{ name?: string; message: string }> = [];
    let fixTasksDecomposed = false;
    let reviewCallCount = 0;

    const context = createMockContext({
      streamAndWait: async (prompt: string, options?: { hideContent?: boolean }) => {
        streamCallCount++;
        
        if (streamCallCount === 1) {
          // Step 1: Initial task decomposition
          return {
            content: JSON.stringify([
              { id: "#1", content: "Initial task", status: "pending", activeForm: "Working" },
            ]),
            wasInterrupted: false,
          };
        }
        
        if (streamCallCount === 2 && options?.hideContent) {
          // Fix task decomposition (after review)
          fixTasksDecomposed = true;
          return {
            content: JSON.stringify([
              { id: "#fix-1", content: "Fix error handling", status: "pending", activeForm: "Fixing" },
            ]),
            wasInterrupted: false,
          };
        }
        
        return { content: "", wasInterrupted: true };
      },
      spawnSubagent: async (options) => {
        spawnCalls.push({ name: options.name, message: options.message });
        reviewCallCount++;
        if (reviewCallCount === 1) {
          // First review: actionable P1 finding
          return {
            success: true,
            output: JSON.stringify({
              findings: [
                {
                  title: "[P1] Missing error handling",
                  body: "The function does not handle errors properly",
                  priority: 1,
                  confidence_score: 0.9,
                  code_location: {
                    absolute_file_path: "/src/test.ts",
                    line_range: { start: 10, end: 15 },
                  },
                },
              ],
              overall_correctness: "patch is incorrect",
              overall_explanation: "Missing error handling in critical path",
              overall_confidence_score: 0.85,
            }),
          };
        }
        // Second review: LGTM
        return {
          success: true,
          output: JSON.stringify({
            findings: [],
            overall_correctness: "correct",
            overall_explanation: "All good",
            overall_confidence_score: 1.0,
          }),
        };
      },
      clearContext: async () => {},
      setRalphSessionDir: (dir: string | null) => {
        sessionDir = dir;
        if (dir) {
          const { mkdirSync } = require("fs");
          mkdirSync(dir, { recursive: true });
        }
      },
      setRalphSessionId: () => {},
      setRalphTaskIds: () => {},
      updateWorkflowState: () => {},
    });

    const ralphCommand = getWorkflowCommands().find((cmd) => cmd.name === "ralph");
    const result = await ralphCommand!.execute("Build a feature", context);
    expect(result.success).toBe(true);
    
    // Verify reviewer was spawned
    expect(spawnCalls.length).toBeGreaterThanOrEqual(1);
    expect(spawnCalls[0]?.name).toBe("reviewer");
    
    // Verify fix tasks were decomposed (re-invocation happened)
    expect(fixTasksDecomposed).toBe(true);
    
    // Verify review artifacts were saved
    if (sessionDir) {
      const { existsSync } = require("fs");
      expect(existsSync(join(sessionDir, "review-0.json"))).toBe(true);
      expect(existsSync(join(sessionDir, "fix-spec-0.md"))).toBe(true);
      
      await rm(sessionDir, { recursive: true, force: true });
    }
  });

  test("stops fix loop when fix tasks are dependency-blocked", async () => {
    let streamCallCount = 0;
    let sessionDir: string | null = null;
    let reviewCallCount = 0;

    const context = createMockContext({
      streamAndWait: async (_prompt: string, options?: { hideContent?: boolean }) => {
        streamCallCount++;

        if (streamCallCount === 1) {
          return {
            content: JSON.stringify([
              { id: "#1", content: "Initial task", status: "pending", activeForm: "Working" },
            ]),
            wasInterrupted: false,
          };
        }

        if (streamCallCount === 2 && options?.hideContent) {
          // Fix task decomposition with dependencies
          return {
            content: JSON.stringify([
              { id: "#fix-1", content: "Fix root issue", status: "pending", activeForm: "Fixing" },
              {
                id: "#fix-2",
                content: "Fix dependent issue",
                status: "pending",
                activeForm: "Waiting",
                blockedBy: ["#fix-1"],
              },
            ]),
            wasInterrupted: false,
          };
        }

        return { content: "", wasInterrupted: false };
      },
      spawnSubagent: async () => {
        reviewCallCount++;
        if (reviewCallCount === 1) {
          return {
            success: true,
            output: JSON.stringify({
              findings: [
                {
                  title: "[P1] Issue requiring fix",
                  body: "Needs follow-up task",
                  priority: 1,
                },
              ],
              overall_correctness: "patch is incorrect",
              overall_explanation: "Fix required",
              overall_confidence_score: 0.9,
            }),
          };
        }
        // Second review: LGTM
        return {
          success: true,
          output: JSON.stringify({
            findings: [],
            overall_correctness: "correct",
            overall_explanation: "All good",
            overall_confidence_score: 1.0,
          }),
        };
      },
      spawnSubagentParallel: async (agents) => {
        // Fix workers fail, causing dependency deadlock
        if (agents.some((a) => a.agentId.startsWith("fix-worker-"))) {
          return agents.map((a) => ({
            agentId: a.agentId,
            success: false,
            output: "Error: fix failed",
            toolUses: 0,
            durationMs: 100,
          }));
        }
        // Main workers succeed
        return agents.map((a) => ({
          agentId: a.agentId,
          success: true,
          output: "Done",
          toolUses: 1,
          durationMs: 100,
        }));
      },
      clearContext: async () => {},
      setRalphSessionDir: (dir: string | null) => {
        sessionDir = dir;
        if (dir) {
          const { mkdirSync } = require("fs");
          mkdirSync(dir, { recursive: true });
        }
      },
      setRalphSessionId: () => {},
      setRalphTaskIds: () => {},
      updateWorkflowState: () => {},
    });

    const ralphCommand = getWorkflowCommands().find((cmd) => cmd.name === "ralph");
    const result = await ralphCommand!.execute("Build a feature", context);
    expect(result.success).toBe(true);
    expect(streamCallCount).toBe(2);

    if (sessionDir) {
      await rm(sessionDir, { recursive: true, force: true });
    }
  });
});

describe("workflow inline mode", () => {
  test("workflow completion returns stateUpdate with workflowActive: false", async () => {
    // Mock streamAndWait to return a valid task JSON response
    const taskJson = JSON.stringify([
      { id: "#1", content: "Test task", status: "completed", activeForm: "Testing" }
    ]);
    const commands = getWorkflowCommands();
    const ralphCommand = commands.find((cmd) => cmd.name === "ralph");
    expect(ralphCommand).toBeDefined();
    
    const context = createMockContext({
      streamAndWait: async () => ({ content: taskJson, wasInterrupted: false }),
      state: { isStreaming: false, messageCount: 0, workflowActive: false },
    });
    
    const result = await ralphCommand!.execute("Build a feature", context);
    expect(result.success).toBe(true);
    expect(result.stateUpdate).toBeDefined();
    expect(result.stateUpdate?.workflowActive).toBe(false);
    expect(result.stateUpdate?.workflowType).toBeNull();
    expect(result.stateUpdate?.initialPrompt).toBeNull();
  });

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

  test("clearContext is not called during workflow execution", async () => {
    let clearContextCalled = false;
    const taskJson = JSON.stringify([
      { id: "#1", content: "Test task", status: "completed", activeForm: "Testing" }
    ]);
    const commands = getWorkflowCommands();
    const ralphCommand = commands.find((cmd) => cmd.name === "ralph");
    
    const context = createMockContext({
      streamAndWait: async () => ({ content: taskJson, wasInterrupted: false }),
      clearContext: async () => { clearContextCalled = true; },
      state: { isStreaming: false, messageCount: 0, workflowActive: false },
    });
    
    await ralphCommand!.execute("Build a feature", context);
    expect(clearContextCalled).toBe(false);
  });

  test("interrupted step1 waits for user input and continues", async () => {
    const commands = getWorkflowCommands();
    const ralphCommand = commands.find((cmd) => cmd.name === "ralph");
    const prompts: string[] = [];
    let streamCallCount = 0;
    let waitForUserInputCalled = false;

    const context = createMockContext({
      waitForUserInput: async () => {
        waitForUserInputCalled = true;
        return "retry planning with smaller scope";
      },
      streamAndWait: async (prompt: string) => {
        prompts.push(prompt);
        streamCallCount++;

        if (streamCallCount === 1) {
          return { content: "", wasInterrupted: true };
        }

        if (streamCallCount === 2) {
          return {
            content: JSON.stringify([
              {
                id: "#1",
                content: "Test task",
                status: "completed",
                activeForm: "Testing",
              },
            ]),
            wasInterrupted: false,
          };
        }

        return { content: "done", wasInterrupted: false };
      },
      state: { isStreaming: false, messageCount: 0, workflowActive: false },
    });

    const result = await ralphCommand!.execute("Build something", context);

    expect(waitForUserInputCalled).toBe(true);
    expect(streamCallCount).toBeGreaterThanOrEqual(2);
    expect(prompts[1]).toContain("retry planning with smaller scope");
    expect(result.success).toBe(true);
    expect(result.stateUpdate).toBeDefined();
    expect(result.stateUpdate?.workflowActive).toBe(false);
  });
});

describe("workflow inline mode integration", () => {
  test("#16 - Ralph end-to-end without clearContext calls", async () => {
    let clearContextCalled = false;
    let streamCallCount = 0;
    let sessionDir: string | null = null;
    const spawnCalls: Array<{ name?: string; message: string }> = [];
    let reviewCallCount = 0;

    const context = createMockContext({
      streamAndWait: async (prompt: string, options?: { hideContent?: boolean }) => {
        streamCallCount++;

        if (streamCallCount === 1) {
          // Step 1: Initial task decomposition
          return {
            content: JSON.stringify([
              { id: "#1", content: "Task 1", status: "pending", activeForm: "Working" },
            ]),
            wasInterrupted: false,
          };
        }

        if (streamCallCount === 2 && options?.hideContent) {
          // Step 3: Fix task decomposition (after review finds issues)
          return {
            content: JSON.stringify([
              { id: "#fix-1", content: "Fix this", status: "pending", activeForm: "Fixing" },
            ]),
            wasInterrupted: false,
          };
        }

        return { content: "", wasInterrupted: false };
      },
      spawnSubagent: async (options) => {
        spawnCalls.push({ name: options.name, message: options.message });
        reviewCallCount++;
        if (reviewCallCount === 1) {
          // First review: return findings
          return {
            success: true,
            output: JSON.stringify({
              findings: [
                {
                  title: "[P1] Fix this",
                  body: "Details",
                  priority: 1,
                },
              ],
              overall_correctness: "patch is incorrect",
              overall_explanation: "Fix needed",
              overall_confidence_score: 0.9,
            }),
          };
        }
        // Second review: LGTM
        return {
          success: true,
          output: JSON.stringify({
            findings: [],
            overall_correctness: "correct",
            overall_explanation: "LGTM",
            overall_confidence_score: 1.0,
          }),
        };
      },
      clearContext: async () => {
        clearContextCalled = true;
      },
      setRalphSessionDir: (dir: string | null) => {
        sessionDir = dir;
        if (dir) {
          const { mkdirSync } = require("fs");
          mkdirSync(dir, { recursive: true });
        }
      },
      setRalphSessionId: () => {},
      setRalphTaskIds: () => {},
      updateWorkflowState: () => {},
    });

    const ralphCommand = getWorkflowCommands().find((cmd) => cmd.name === "ralph");
    expect(ralphCommand).toBeDefined();

    const result = await ralphCommand!.execute("Build feature", context);

    // Assert: clearContext was NEVER called
    expect(clearContextCalled).toBe(false);
    
    // Assert: result.success is true
    expect(result.success).toBe(true);
    
    // Assert: result.stateUpdate.workflowActive is false
    expect(result.stateUpdate?.workflowActive).toBe(false);

    // Cleanup
    if (sessionDir) {
      await rm(sessionDir, { recursive: true, force: true });
    }
  });

  test("#17 - user prompt passthrough after Ctrl+C in workflow", async () => {
    let streamCallCount = 0;
    let sessionDir: string | null = null;
    const streamPrompts: string[] = [];
    let waitForUserInputCalled = false;

    const context = createMockContext({
      waitForUserInput: async () => {
        waitForUserInputCalled = true;
        return "please fix the button color";
      },
      streamAndWait: async (prompt: string) => {
        streamCallCount++;
        streamPrompts.push(prompt);

        if (streamCallCount === 1) {
          // Step 1: Initial decomposition - Ctrl+C interruption
          return {
            content: "",
            wasInterrupted: true,
          };
        }

        if (streamCallCount === 2) {
          // Step 1 retry: should contain user's prompt
          return {
            content: JSON.stringify([
              { id: "#1", content: "Task 1", status: "pending", activeForm: "Working" },
              { id: "#2", content: "Task 2", status: "pending", activeForm: "Working" },
            ]),
            wasInterrupted: false,
          };
        }

        return { content: "", wasInterrupted: false };
      },
      spawnSubagent: async () => {
        // Return clean review (no actionable findings)
        return {
          success: true,
          output: JSON.stringify({
            findings: [],
            overall_correctness: "correct",
            overall_explanation: "All changes look good",
            overall_confidence_score: 0.95,
          }),
        };
      },
      setRalphSessionDir: (dir: string | null) => {
        sessionDir = dir;
        if (dir) {
          const { mkdirSync } = require("fs");
          mkdirSync(dir, { recursive: true });
        }
      },
      setRalphSessionId: () => {},
      setRalphTaskIds: () => {},
      updateWorkflowState: () => {},
    });

    const ralphCommand = getWorkflowCommands().find((cmd) => cmd.name === "ralph");
    expect(ralphCommand).toBeDefined();

    const result = await ralphCommand!.execute("Build feature", context);

    // Verify waitForUserInput was called
    expect(waitForUserInputCalled).toBe(true);

    // Verify the second streamAndWait call's prompt contains the user's input
    expect(streamPrompts.length).toBeGreaterThanOrEqual(2);
    expect(streamPrompts[1]).toContain("please fix the button color");

    // Verify result.success is true
    expect(result.success).toBe(true);

    // Cleanup
    if (sessionDir) {
      await rm(sessionDir, { recursive: true, force: true });
    }
  });

  test("#18 - task list persists after Ctrl+C, hides on completion", async () => {
    let streamCallCount = 0;
    let sessionDir: string | null = null;
    const setRalphSessionDirCalls: Array<string | null> = [];
    const updateWorkflowStateCalls: Array<Partial<{ workflowActive: boolean }>> = [];

    const context = createMockContext({
      waitForUserInput: async () => "continue",
      streamAndWait: async (prompt: string) => {
        streamCallCount++;

        if (streamCallCount === 1) {
          // Step 1: Initial decomposition
          return {
            content: JSON.stringify([
              { id: "#1", content: "Task 1", status: "pending", activeForm: "Working" },
            ]),
            wasInterrupted: false,
          };
        }

        return { content: "", wasInterrupted: false };
      },
      spawnSubagent: async () => {
        // Return clean review
        return {
          success: true,
          output: JSON.stringify({
            findings: [],
            overall_correctness: "correct",
            overall_explanation: "All good",
            overall_confidence_score: 0.95,
          }),
        };
      },
      setRalphSessionDir: (dir: string | null) => {
        setRalphSessionDirCalls.push(dir);
        sessionDir = dir;
        if (dir) {
          const { mkdirSync } = require("fs");
          mkdirSync(dir, { recursive: true });
        }
      },
      updateWorkflowState: (state: Partial<{ workflowActive: boolean }>) => {
        updateWorkflowStateCalls.push(state);
      },
      setRalphSessionId: () => {},
      setRalphTaskIds: () => {},
    });

    const ralphCommand = getWorkflowCommands().find((cmd) => cmd.name === "ralph");
    expect(ralphCommand).toBeDefined();

    const result = await ralphCommand!.execute("Build feature", context);

    // Verify setRalphSessionDir was called with a non-null path at start
    expect(setRalphSessionDirCalls.length).toBeGreaterThan(0);
    expect(setRalphSessionDirCalls[0]).not.toBeNull();

    // Verify setRalphSessionDir(null) was NOT called during workflow
    const nullCalls = setRalphSessionDirCalls.filter((dir) => dir === null);
    expect(nullCalls.length).toBe(0);

    // Verify result.stateUpdate.workflowActive is false (signals task list should hide)
    expect(result.stateUpdate?.workflowActive).toBe(false);

    // Cleanup
    if (sessionDir) {
      await rm(sessionDir, { recursive: true, force: true });
    }
  });
});
