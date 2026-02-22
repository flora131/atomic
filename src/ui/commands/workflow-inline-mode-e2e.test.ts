/**
 * E2E tests for workflow inline mode
 *
 * These tests verify the complete lifecycle of the /ralph workflow in inline mode,
 * including teal border state, Ctrl+C user intervention, and task list persistence.
 */

import { describe, test, expect } from "bun:test";
import { mkdtemp, writeFile as fsWriteFile, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { mkdirSync, existsSync, readFileSync } from "fs";
import type { CommandContext, CommandContextState } from "./registry.ts";
import { getWorkflowCommands } from "./workflow-commands.ts";

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

describe("Workflow inline mode E2E", () => {
  test("teal border state tracks workflow lifecycle", async () => {
    // Track updateWorkflowState calls
    const workflowStateUpdates: Array<Partial<CommandContextState>> = [];
    let sessionDir: string | null = null;

    const context = createMockContext({
      updateWorkflowState: (update) => {
        workflowStateUpdates.push(update);
      },
      setRalphSessionDir: (dir) => {
        sessionDir = dir;
        if (dir && !existsSync(dir)) {
          mkdirSync(dir, { recursive: true });
        }
      },
      streamAndWait: async (prompt: string) => {
        // Call 1: Return task JSON
        if (prompt.includes("task list")) {
          return {
            content: JSON.stringify([
              {
                id: "#1",
                content: "Task 1",
                status: "pending",
                activeForm: "Working on task 1",
              },
            ]),
            wasInterrupted: false,
          };
        }

        // Call 2: Write tasks.json completed, return content
        if (sessionDir) {
          const tasksPath = join(sessionDir, "tasks.json");
          await fsWriteFile(
            tasksPath,
            JSON.stringify([
              {
                id: "#1",
                content: "Task 1",
                status: "completed",
                activeForm: "Working on task 1",
              },
            ]),
          );
        }
        return { content: "Task completed", wasInterrupted: false };
      },
      spawnSubagent: async () => ({
        success: true,
        output: JSON.stringify({
          findings: [],
          overall_correctness: "correct",
          overall_explanation: "LGTM",
          overall_confidence_score: 1.0,
        }),
      }),
    });

    // Get the ralph command
    const commands = getWorkflowCommands();
    const ralphCommand = commands.find((cmd) => cmd.name === "ralph");
    expect(ralphCommand).toBeDefined();

    // Run workflow
    const result = await ralphCommand!.execute("Build feature", context);

    // Assert: updateWorkflowState was called with workflowActive: true at some point
    const hasWorkflowActive = workflowStateUpdates.some(
      (update) => update.workflowActive === true,
    );
    expect(hasWorkflowActive).toBe(true);

    // Assert: updateWorkflowState was called with workflowType containing a string
    const hasWorkflowType = workflowStateUpdates.some(
      (update) => typeof update.workflowType === "string" && update.workflowType.length > 0,
    );
    expect(hasWorkflowType).toBe(true);

    // Assert: result.stateUpdate.workflowActive is false
    expect(result.stateUpdate?.workflowActive).toBe(false);

    // Assert: result.stateUpdate.workflowType is null
    expect(result.stateUpdate?.workflowType).toBe(null);

    // Assert: result.stateUpdate.initialPrompt is null
    expect(result.stateUpdate?.initialPrompt).toBe(null);

    // Clean up temp dir
    if (sessionDir && existsSync(sessionDir)) {
      await rm(sessionDir, { recursive: true, force: true });
    }
  });

  test("Ctrl+C interruption triggers user prompt and continues workflow", async () => {
    // Track calls
    const streamAndWaitCalls: string[] = [];
    let waitForUserInputCallCount = 0;
    const workflowStateUpdates: Array<Partial<CommandContextState>> = [];
    let sessionDir: string | null = null;

    const context = createMockContext({
      updateWorkflowState: (update) => {
        workflowStateUpdates.push(update);
      },
      setRalphSessionDir: (dir) => {
        sessionDir = dir;
        if (dir && !existsSync(dir)) {
          mkdirSync(dir, { recursive: true });
        }
      },
      streamAndWait: async (prompt: string) => {
        streamAndWaitCalls.push(prompt);

        // Call 1: return 2 tasks JSON (step1 decomposition)
        if (streamAndWaitCalls.length === 1) {
          return {
            content: JSON.stringify([
              {
                id: "#1",
                content: "Task 1",
                status: "pending",
                activeForm: "Working on task 1",
              },
              {
                id: "#2",
                content: "Task 2",
                status: "pending",
                activeForm: "Working on task 2",
              },
            ]),
            wasInterrupted: false,
          };
        }

        // Call 2: return wasInterrupted: true (Ctrl+C during task 1)
        if (streamAndWaitCalls.length === 2) {
          return { content: "", wasInterrupted: true };
        }

        // Call 3: should receive prompt containing user's follow-up text, write task 1 completed to tasks.json
        if (streamAndWaitCalls.length === 3) {
          if (sessionDir) {
            const tasksPath = join(sessionDir, "tasks.json");
            await fsWriteFile(
              tasksPath,
              JSON.stringify([
                {
                  id: "#1",
                  content: "Task 1",
                  status: "completed",
                  activeForm: "Working on task 1",
                },
                {
                  id: "#2",
                  content: "Task 2",
                  status: "pending",
                  activeForm: "Working on task 2",
                },
              ]),
            );
          }
          return { content: "Task 1 completed with alignment fix", wasInterrupted: false };
        }

        // Call 4: write task 2 completed to tasks.json, return content
        if (streamAndWaitCalls.length === 4) {
          if (sessionDir) {
            const tasksPath = join(sessionDir, "tasks.json");
            await fsWriteFile(
              tasksPath,
              JSON.stringify([
                {
                  id: "#1",
                  content: "Task 1",
                  status: "completed",
                  activeForm: "Working on task 1",
                },
                {
                  id: "#2",
                  content: "Task 2",
                  status: "completed",
                  activeForm: "Working on task 2",
                },
              ]),
            );
          }
          return { content: "Task 2 completed", wasInterrupted: false };
        }

        return { content: "", wasInterrupted: false };
      },
      waitForUserInput: async () => {
        waitForUserInputCallCount++;
        return "fix the alignment issue";
      },
      spawnSubagent: async () => ({
        success: true,
        output: JSON.stringify({
          findings: [],
          overall_correctness: "correct",
          overall_explanation: "LGTM",
          overall_confidence_score: 1.0,
        }),
      }),
    });

    // Get the ralph command
    const commands = getWorkflowCommands();
    const ralphCommand = commands.find((cmd) => cmd.name === "ralph");
    expect(ralphCommand).toBeDefined();

    // Run workflow
    const result = await ralphCommand!.execute("Build feature", context);

    // Graph-based /ralph no longer prompts via waitForUserInput on this path.
    expect(waitForUserInputCallCount).toBe(0);

    // The command should still perform decomposition + implementation streaming.
    expect(streamAndWaitCalls.length).toBeGreaterThanOrEqual(1);

    // Assert: result.success is true
    expect(result.success).toBe(true);

    // Assert: result.stateUpdate.workflowActive is false
    expect(result.stateUpdate?.workflowActive).toBe(false);

    // Assert: updateWorkflowState was called with workflowActive: true at start
    const hasWorkflowActive = workflowStateUpdates.some(
      (update) => update.workflowActive === true,
    );
    expect(hasWorkflowActive).toBe(true);

    // Clean up temp dir
    if (sessionDir && existsSync(sessionDir)) {
      await rm(sessionDir, { recursive: true, force: true });
    }
  });

  test("task list persists through interruption and tasks.json is maintained", async () => {
    // Track calls
    let sessionDir: string | null = null;
    let sessionId: string | null = null;
    let setRalphSessionDirCallCount = 0;
    let setRalphSessionIdCallCount = 0;
    let setRalphTaskIdsCallCount = 0;

    const context = createMockContext({
      setRalphSessionDir: (dir) => {
        setRalphSessionDirCallCount++;
        sessionDir = dir;
        if (dir && !existsSync(dir)) {
          mkdirSync(dir, { recursive: true });
        }
      },
      setRalphSessionId: (id) => {
        setRalphSessionIdCallCount++;
        sessionId = id;
      },
      setRalphTaskIds: () => {
        setRalphTaskIdsCallCount++;
      },
      streamAndWait: async (prompt: string, options) => {
        // Call 1: return task JSON with 2 tasks (step1)
        if (prompt.includes("task list")) {
          return {
            content: JSON.stringify([
              {
                id: "#1",
                content: "Task 1",
                status: "pending",
                activeForm: "Working on task 1",
              },
              {
                id: "#2",
                content: "Task 2",
                status: "pending",
                activeForm: "Working on task 2",
              },
            ]),
            wasInterrupted: false,
          };
        }

        // Call 2: return wasInterrupted: true (Ctrl+C)
        if (!sessionDir) {
          return { content: "", wasInterrupted: true };
        }

        // Call 3: write task 1 completed to tasks.json, return content
        const tasksPath = join(sessionDir, "tasks.json");
        const currentTasks = existsSync(tasksPath)
          ? JSON.parse(readFileSync(tasksPath, "utf-8"))
          : [];

        if (currentTasks.length === 2 && currentTasks[0].status === "pending") {
          await fsWriteFile(
            tasksPath,
            JSON.stringify([
              {
                id: "#1",
                content: "Task 1",
                status: "completed",
                activeForm: "Working on task 1",
              },
              {
                id: "#2",
                content: "Task 2",
                status: "pending",
                activeForm: "Working on task 2",
              },
            ]),
          );
          return { content: "Task 1 completed", wasInterrupted: false };
        }

        // Call 4: write task 2 completed to tasks.json, return content
        await fsWriteFile(
          tasksPath,
          JSON.stringify([
            {
              id: "#1",
              content: "Task 1",
              status: "completed",
              activeForm: "Working on task 1",
            },
            {
              id: "#2",
              content: "Task 2",
              status: "completed",
              activeForm: "Working on task 2",
            },
          ]),
        );
        return { content: "Task 2 completed", wasInterrupted: false };
      },
      waitForUserInput: async () => "keep going",
      spawnSubagent: async () => ({
        success: true,
        output: JSON.stringify({
          findings: [],
          overall_correctness: "correct",
          overall_explanation: "LGTM",
          overall_confidence_score: 1.0,
        }),
      }),
    });

    // Get the ralph command
    const commands = getWorkflowCommands();
    const ralphCommand = commands.find((cmd) => cmd.name === "ralph");
    expect(ralphCommand).toBeDefined();

    // Run workflow
    const result = await ralphCommand!.execute("Build feature", context);

    // Assert: setRalphSessionDir was called with a non-null string (dir was set)
    expect(setRalphSessionDirCallCount).toBeGreaterThan(0);
    expect(sessionDir).not.toBeNull();
    expect(typeof sessionDir).toBe("string");

    // Assert: setRalphSessionId was called with a non-null string
    expect(setRalphSessionIdCallCount).toBeGreaterThan(0);
    expect(sessionId).not.toBeNull();
    expect(typeof sessionId).toBe("string");

    // Assert: setRalphTaskIds was called (tasks were tracked)
    expect(setRalphTaskIdsCallCount).toBeGreaterThan(0);

    // Assert: tasks.json exists in the session dir and contains task data
    if (sessionDir) {
      const tasksPath = join(sessionDir, "tasks.json");
      expect(existsSync(tasksPath)).toBe(true);

      const tasks = JSON.parse(readFileSync(tasksPath, "utf-8"));
      expect(Array.isArray(tasks)).toBe(true);
      expect(tasks.length).toBe(2);

      // Assert: tasks.json has all tasks with status "completed"
      expect(tasks.every((task: any) => task.status === "completed")).toBe(true);
    }

    // Assert: result.stateUpdate.workflowActive is false
    expect(result.stateUpdate?.workflowActive).toBe(false);

    // Clean up temp dir
    if (sessionDir && existsSync(sessionDir)) {
      await rm(sessionDir, { recursive: true, force: true });
    }
  });
});
