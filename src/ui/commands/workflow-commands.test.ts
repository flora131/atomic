import { describe, expect, test } from "bun:test";
import { mkdtemp, writeFile as fsWriteFile, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import type { CommandContext } from "./registry.ts";
import { getWorkflowCommands, parseRalphArgs } from "./workflow-commands.ts";

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
    streamAndWait: async () => ({ content: "", wasInterrupted: false }),
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
    
    // Verify context was cleared before review
    expect(clearCallCount).toBeGreaterThanOrEqual(1);
    
    // Cleanup
    await rm(tempDir, { recursive: true, force: true });
    if (sessionDir) {
      await rm(sessionDir, { recursive: true, force: true });
    }
  });

  test("does not spawn reviewer when tasks are not all completed", async () => {
    const spawnCalls: Array<{ name?: string }> = [];
    let streamCallCount = 0;
    let sessionDir: string | null = null;

    const context = createMockContext({
      streamAndWait: async () => {
        streamCallCount++;
        if (streamCallCount === 1) {
          return {
            content: JSON.stringify([
              { id: "#1", content: "Test task", status: "pending", activeForm: "Testing" },
            ]),
            wasInterrupted: false,
          };
        }
        // Write tasks with one still pending (not all completed)
        if (sessionDir) {
          await fsWriteFile(
            join(sessionDir, "tasks.json"),
            JSON.stringify([
              { id: "#1", content: "Test task", status: "pending", activeForm: "Testing" },
            ])
          );
        }
        // After first iteration, return interrupted to stop loop
        if (streamCallCount > 2) {
          return { content: "", wasInterrupted: true };
        }
        return { content: "", wasInterrupted: false };
      },
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
        
        if (streamCallCount === 2) {
          // Step 2: Implementation loop - write completed tasks
          if (sessionDir) {
            await fsWriteFile(
              join(sessionDir, "tasks.json"),
              JSON.stringify([
                { id: "#1", content: "Initial task", status: "completed", activeForm: "Working" },
              ])
            );
          }
          return { content: "", wasInterrupted: false };
        }
        
        if (streamCallCount === 3 && options?.hideContent) {
          // Step 3: Fix task decomposition (after review)
          fixTasksDecomposed = true;
          return {
            content: JSON.stringify([
              { id: "#fix-1", content: "Fix error handling", status: "pending", activeForm: "Fixing" },
            ]),
            wasInterrupted: false,
          };
        }
        
        if (streamCallCount === 4) {
          // Step 4: Fix implementation loop
          if (sessionDir) {
            await fsWriteFile(
              join(sessionDir, "tasks.json"),
              JSON.stringify([
                { id: "#fix-1", content: "Fix error handling", status: "completed", activeForm: "Fixing" },
              ])
            );
          }
          return { content: "", wasInterrupted: false };
        }
        
        return { content: "", wasInterrupted: true };
      },
      spawnSubagent: async (options) => {
        spawnCalls.push({ name: options.name, message: options.message });
        // Return review with actionable P1 finding
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
    expect(spawnCalls.length).toBe(1);
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
});
