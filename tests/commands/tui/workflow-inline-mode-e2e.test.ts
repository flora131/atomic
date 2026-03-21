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
import type { CommandContext, CommandContextState } from "@/commands/tui/registry.ts";
import { getWorkflowCommands } from "@/commands/tui/workflow-commands.ts";

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  timeoutMessage: string,
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timeoutId = setTimeout(
          () => reject(new Error(timeoutMessage)),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

/**
 * Create a mock `createAgentSession` factory.
 *
 * Returns a function that, when called, produces a mock Session whose
 * `stream()` method detects the conductor stage from prompt keywords and
 * returns appropriate content for each Ralph stage.
 *
 * @param streamOverride  Optional custom stream generator. When provided,
 *   all sessions use this instead of the default keyword-based routing.
 */
let mockSessionCounter = 0;
function createMockAgentSession(
  streamOverride?: (message: string, options?: { agent?: string; abortSignal?: AbortSignal }) => AsyncIterable<{ type: "text"; content: string }>,
) {
  return async () => ({
    id: `mock-session-${++mockSessionCounter}`,
    send: async () => ({ type: "text" as const, content: "" }),
    stream: streamOverride ?? (async function* (message: string) {
      // Planner stage — "task decomposition engine"
      if (message.includes("task decomposition engine") || message.includes("Decompose")) {
        yield {
          type: "text" as const,
          content: JSON.stringify([
            { id: "#1", description: "Implement feature", status: "pending", summary: "Implementing feature", blockedBy: [] },
          ]),
        };
        return;
      }
      // Reviewer stage — "Code Review Request"
      if (message.includes("Code Review Request")) {
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
      // Default (orchestrator, debugger, etc.)
      yield { type: "text" as const, content: "Stage completed." };
    }),
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

describe("Workflow inline mode E2E", () => {
  test("teal border state tracks workflow lifecycle", async () => {
    // Track updateWorkflowState calls
    const workflowStateUpdates: Array<Partial<CommandContextState>> = [];
    let sessionDir: string | null = null;

    const context = createMockContext({
      createAgentSession: createMockAgentSession(),
      updateWorkflowState: (update) => {
        workflowStateUpdates.push(update);
      },
      setWorkflowSessionDir: (dir) => {
        sessionDir = dir;
        if (dir && !existsSync(dir)) {
          mkdirSync(dir, { recursive: true });
        }
      },
      streamAndWait: async (prompt: string) => {
        // Step 1: Return task JSON
        if (prompt.includes("task list")) {
          return {
            content: JSON.stringify([
              {
                id: "#1",
                description: "Task 1",
                status: "pending",
                summary: "Working on task 1",
              },
            ]),
            wasInterrupted: false,
          };
        }
        return { content: "", wasInterrupted: false };
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



  test("review with findings triggers fixer and completes within timeout", async () => {
    // Track stage transitions via conductor's onStageTransition callback
    const stageTransitions: string[] = [];
    const workflowStateUpdates: Array<Partial<CommandContextState>> = [];
    let sessionDir: string | null = null;

    const context = createMockContext({
      updateWorkflowState: (update) => {
        workflowStateUpdates.push(update);
        // Track stage transitions from conductor
        if (update.currentStage) {
          stageTransitions.push(update.currentStage);
        }
      },
      setWorkflowSessionDir: (dir) => {
        sessionDir = dir;
        if (dir && !existsSync(dir)) {
          mkdirSync(dir, { recursive: true });
          // Create progress.txt file that reviewer needs
          const progressPath = join(dir, "progress.txt");
          fsWriteFile(progressPath, "Test workflow in progress\n", "utf-8").catch(() => {});
        }
      },
      setWorkflowSessionId: () => {},
      setWorkflowTaskIds: () => {},
      // Conductor uses createAgentSession for per-stage sessions
      createAgentSession: createMockAgentSession(async function* (message: string) {
        // Planner stage — return task list
        if (message.includes("task decomposition engine") || message.includes("Decompose")) {
          yield {
            type: "text" as const,
            content: JSON.stringify([
              { id: "#1", description: "Add auth module", status: "pending", summary: "Adding auth", blockedBy: [] },
            ]),
          };
          return;
        }
        // Reviewer stage — return findings that trigger the debugger
        if (message.includes("Code Review Request")) {
          yield {
            type: "text" as const,
            content: JSON.stringify({
              findings: [
                {
                  file: "src/auth.ts",
                  description: "Missing input validation",
                  severity: "high",
                  priority: 1,
                },
              ],
              overall_correctness: "patch is correct",
              overall_explanation: "Missing input validation in auth handler",
            }),
          };
          return;
        }
        // Default (orchestrator, debugger, etc.)
        yield { type: "text" as const, content: "Stage completed." };
      }),
    });

    // Get the ralph command
    const commands = getWorkflowCommands();
    const ralphCommand = commands.find((cmd) => cmd.name === "ralph");
    expect(ralphCommand).toBeDefined();

    // Run workflow — should complete without hanging
    const result = await withTimeout(
      Promise.resolve(ralphCommand!.execute("Build auth feature", context)),
      5_000,
      "ralph workflow did not complete in time",
    );

    // Assert: workflow completed successfully
    expect(result.success).toBe(true);
    expect(result.stateUpdate?.workflowActive).toBe(false);

    // Assert: workflowActive was set to true at start
    const hasWorkflowActive = workflowStateUpdates.some(
      (update) => update.workflowActive === true,
    );
    expect(hasWorkflowActive).toBe(true);

    // Assert: conductor transitioned through all stages including debugger
    // (debugger runs because reviewer returned findings)
    expect(stageTransitions).toContain("planner");
    expect(stageTransitions).toContain("orchestrator");
    expect(stageTransitions).toContain("reviewer");
    expect(stageTransitions).toContain("debugger");

    // Assert: session dir was set
    expect(sessionDir).not.toBeNull();

    // Clean up temp dir
    if (sessionDir && existsSync(sessionDir)) {
      await rm(sessionDir, { recursive: true, force: true });
    }
  });

  test("keeps TUI workflow state responsive while orchestrator stage is in-flight", async () => {
    const workflowStateUpdates: Array<Partial<CommandContextState>> = [];
    const trackedSessionDirs: Array<string | null> = [];
    const trackedSessionIds: Array<string | null> = [];
    const trackedTaskIdSizes: number[] = [];
    let sessionDir: string | null = null;

    const orchestratorStarted = createDeferred<void>();
    const releaseOrchestrator = createDeferred<void>();

    const context = createMockContext({
      updateWorkflowState: (update) => {
        workflowStateUpdates.push(update);
      },
      setWorkflowSessionDir: (dir) => {
        trackedSessionDirs.push(dir);
        sessionDir = dir;
        if (dir && !existsSync(dir)) {
          mkdirSync(dir, { recursive: true });
          const progressPath = join(dir, "progress.txt");
          fsWriteFile(progressPath, "Test workflow in progress\n", "utf-8").catch(() => {});
        }
      },
      setWorkflowSessionId: (id) => {
        trackedSessionIds.push(id);
      },
      setWorkflowTaskIds: (ids) => {
        trackedTaskIdSizes.push(ids.size);
      },
      // Conductor uses createAgentSession for per-stage sessions
      createAgentSession: createMockAgentSession(async function* (message: string) {
        // Planner: return 2 tasks
        if (message.includes("task decomposition engine") || message.includes("Decompose")) {
          yield {
            type: "text" as const,
            content: JSON.stringify([
              { id: "#1", description: "Implement auth", status: "pending", summary: "Implementing auth", blockedBy: [] },
              { id: "#2", description: "Add tests", status: "pending", summary: "Adding tests", blockedBy: [] },
            ]),
          };
          return;
        }
        // Orchestrator: pause to simulate long-running execution
        if (!message.includes("Code Review Request") && !message.includes("Fix Request")) {
          orchestratorStarted.resolve(undefined);
          await releaseOrchestrator.promise;
          yield { type: "text" as const, content: "All tasks completed." };
          return;
        }
        // Reviewer
        if (message.includes("Code Review Request")) {
          yield {
            type: "text" as const,
            content: JSON.stringify({
              findings: [],
              overall_correctness: "patch is correct",
              overall_explanation: "No issues",
            }),
          };
          return;
        }
        yield { type: "text" as const, content: "Done." };
      }),
    });

    const commands = getWorkflowCommands();
    const ralphCommand = commands.find((cmd) => cmd.name === "ralph");
    expect(ralphCommand).toBeDefined();

    const executionPromise = Promise.resolve(
      ralphCommand!.execute("Build auth feature", context),
    );
    await withTimeout(orchestratorStarted.promise, 3_000, "orchestrator stage did not start in time");

    // While orchestrator is still in-flight, the workflow should already have
    // updated TUI state and session/task bindings.
    expect(workflowStateUpdates.some((update) => update.workflowActive === true)).toBe(true);
    expect(trackedSessionDirs.length).toBeGreaterThan(0);
    expect(trackedSessionIds.length).toBeGreaterThan(0);
    expect(trackedTaskIdSizes.some((size) => size >= 2)).toBe(true);

    let resolvedEarly = false;
    void executionPromise.then(() => {
      resolvedEarly = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(resolvedEarly).toBe(false);

    releaseOrchestrator.resolve(undefined);

    const result = await withTimeout(
      executionPromise,
      5_000,
      "ralph workflow did not finish after releasing orchestrator",
    );
    expect(result.success).toBe(true);
    expect(result.stateUpdate?.workflowActive).toBe(false);

    if (sessionDir && existsSync(sessionDir)) {
      await rm(sessionDir, { recursive: true, force: true });
    }
  });
});
